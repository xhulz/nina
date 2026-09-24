/**
 * `nina eval` — does a release's reviewer catch more of a planted set of defects than another's?
 *
 *   nina eval --release 0.23.0 --release 0.24.0 [--repeat 2] [--model <m>] [--keep]
 *   nina eval --release 0.24.0 --dry-run
 *
 * Every rule change so far was argued for and then shipped, and whether it helped was read afterwards
 * from a loop-back rate — a number that moves with the work as much as with the rule, and that went UP
 * after the first two lessons it was asked to verify. This asks the question as an experiment: the same
 * change, carrying the same planted defects (`evals/reviewer/`), is reviewed by the reviewer each
 * release composes, and the report counts what each one caught.
 *
 * It runs `claude -p` as the composed reviewer (`--agent reviewer`) in a throwaway copy of the fixture,
 * on the login Claude Code already has — a subscription, not a per-token bill. Every credential that
 * would bill per token instead is removed from the child's environment unless `--api` says otherwise,
 * so running an eval can never start charging an account by accident. The child reads only: the tools
 * it may use are listed and everything else is refused (`--permission-mode dontAsk`), it loads no user
 * settings (so no global hook snapshots the eval into the owner's statistics), and it writes no session.
 *
 * Grading is deterministic. A defect with an anchor is caught when the report names its file and a
 * line within two of the anchor's; each reported location is given to the nearest defect in its file,
 * so one citation cannot catch four neighbours. A defect without an anchor — a file that should not
 * have changed, or should have been deleted — is caught when the report names the file. Locations that
 * match no planted defect are counted. The grade is a floor: a defect described without a line of its own
 * is missed, and every report is kept so the number can be read against the text.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeProject } from './compose.mjs';

/** Credentials that would make `claude -p` bill per token instead of using the login. */
const BILLED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

/** What the reviewer may do: read the tree and the diff, nothing else. */
const TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git show:*)', 'Bash(git log:*)'];

/** How far a cited line may sit from a defect's anchor and still be that defect. */
const TOLERANCE = 2;

/** The vocabulary the fixture composes with: a plain project, no surfaces. */
const PROFILE = (core) => ({
  core,
  surfaces: [],
  vocabulary: { OWNER: 'the maintainer', API_DIR: 'src/server', APP_DIR: 'src/web', PKG_SCOPE: '@notes', EMITTING_PKGS: '`core`' },
});

/** The prompt the reviewer gets: what a dispatch from the orchestrator would say, and no more. */
const PROMPT =
  'Review the uncommitted change in this repository (git diff) against the spec at ' +
  '.claude/plans/specs/archive-notes.md. Follow your spec and report exactly as it says.';

/**
 * Loads the planted defects, with each anchor resolved to its line in the changed tree.
 *
 * @param {string} fixture - The eval's directory.
 * A defect may name more than one anchor: the places a reviewer could rightly point at — a date the
 * service should have formatted is as visible where the route formats it. Each anchor is looked up in
 * every planted file, and must match exactly one line in all of them.
 *
 * @returns {{id: string, at: {file: string, line: number}[], file: string, line: number|null, what: string}[]}
 *   `at` lists every place; `file` and `line` are the first, for a defect named by its file alone `line` is null.
 */
export function plantedDefects(fixture) {
  const { defects } = JSON.parse(readFileSync(join(fixture, 'defects.json'), 'utf8'));
  const tree = (file) => [join(fixture, 'after', file), join(fixture, 'base', file)].find(existsSync);
  const files = [...new Set(defects.map((d) => d.file))];
  return defects.map((d) => {
    if (!d.anchor) return { id: d.id, at: [], file: d.file, line: null, what: d.what };
    const at = [d.anchor].flat().map((anchor) => {
      const hits = files.flatMap((file) => readFileSync(tree(file), 'utf8').split('\n').flatMap((l, i) => (l.includes(anchor) ? [{ file, line: i + 1 }] : [])));
      if (hits.length !== 1) throw new Error(`defect ${d.id}: its anchor must match exactly one line — "${anchor}" matched ${hits.length}`);
      return hits[0];
    });
    return { id: d.id, at, file: at[0].file, line: at[0].line, what: d.what };
  });
}

/**
 * Grades one report against the planted defects.
 *
 * Approximate in both directions, and kept beside the report for that reason. A cited line goes to the
 * nearest defect anchor in its file within two lines, and a citation equally near two defects credits
 * neither — the planted lines sit one apart, and the defect listed first used to win the tie. A defect
 * named by its file alone is credited only in an issue the report raises: a list item after its
 * `ISSUES` line, and not one marked ✅ — the report's "artifacts checked" section names every file the
 * spec lists, and naming a file there says nothing about a defect in it.
 *
 * @param {string} report - The reviewer's final report.
 * @param {ReturnType<typeof plantedDefects>} defects - What was planted.
 * @returns {{verdict: string|null, late: string|null, caught: string[], missed: string[], other: string[], unlocated: string[]}}
 *   `verdict` is the declared first line, as the gate and the snapshot read it; `late` is a verdict line
 *   the report wrote further down, which they do not read. `other` holds the lines the report cites that
 *   are no planted defect — a real finding, noise, or a premise it confirmed. `unlocated` holds the files
 *   with a line-level defect that the report named without a line (`line 43`, `L43`), which this does not read.
 */
export function grade(report, defects) {
  const text = String(report ?? '');
  const lines = text.split('\n');
  const verdict = /^\s*VERDICT:\s*([A-Z][A-Z-]*)/.exec(lines.find((l) => l.trim()) ?? '')?.[1] ?? null;
  const late = verdict ? null : (/^\s*VERDICT:\s*([A-Z][A-Z-]*)/m.exec(text)?.[1] ?? null);
  const issuesAt = lines.findIndex((l) => /^\s*ISSUES:/.test(l));
  const caught = new Set();
  const other = new Set();
  const unlocated = new Set();
  // A report names a file with a path of its own choosing — `src/server/services/notes.ts`,
  // `services/notes.ts`, or just `notes.ts` — so a citation matches every planted file it is a suffix of.
  const files = [...new Set(defects.flatMap((d) => [d.file, ...d.at.map((a) => a.file)]))];
  const matching = (cited) => files.filter((f) => f === cited || f.endsWith(`/${cited}`));
  const fileLevel = (candidates) => defects.filter((d) => d.line === null && candidates.includes(d.file));
  lines.forEach((text, i) => {
    // A line the report marks ✅ is something it confirmed, not something it found.
    if (text.includes('✅')) return;
    const raised = issuesAt >= 0 && i > issuesAt && /^\s*(?:[-*]|\d+[.)])\s/.test(text);
    // `path:1,36` cites two lines; `path:41-49` cites a block, read as its first line — crediting every
    // defect inside a block would let one citation catch four neighbours again.
    for (const m of text.matchAll(/([\w./-]+\.(?:ts|tsx|js|mjs|json|md))(?::(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*))?/g)) {
      const [, cited, lineList] = m;
      const candidates = matching(cited.replace(/^\.\//, ''));
      if (candidates.length === 0) continue;
      if (raised) for (const d of fileLevel(candidates)) caught.add(d.id);
      if (!lineList) {
        if (defects.some((d) => d.at.some((a) => candidates.includes(a.file)))) unlocated.add(cited);
        continue;
      }
      for (const line of lineList.split(',').map((part) => Number(part.split('-')[0]))) {
        const near = defects
          .flatMap((d) => d.at.filter((a) => candidates.includes(a.file) && Math.abs(a.line - line) <= TOLERANCE).map((a) => ({ id: d.id, distance: Math.abs(a.line - line) })))
          .sort((a, b) => a.distance - b.distance);
        const tied = near.length > 1 && near[1].distance === near[0].distance && near[1].id !== near[0].id;
        if (near.length > 0 && !tied) caught.add(near[0].id);
        else if (fileLevel(candidates).length === 0) other.add(`${cited}:${line}`);
      }
    }
  });
  // A file named with a line somewhere is located, whatever other mention it also got.
  for (const d of defects) if (caught.has(d.id)) for (const a of d.at) unlocated.delete(a.file);
  return {
    verdict,
    late,
    caught: [...caught],
    missed: defects.filter((d) => !caught.has(d.id)).map((d) => d.id),
    other: [...other],
    unlocated: [...unlocated].filter((cited) => !defects.some((d) => caught.has(d.id) && d.at.some((a) => a.file === cited || a.file.endsWith(`/${cited}`)))),
  };
}

/**
 * Builds the reviewer's world for one release: the fixture's base committed, the defective change on
 * top of it uncommitted, and the harness that release composes.
 *
 * @param {string} fixture - The eval's directory.
 * @param {string} core - The release to compose.
 * @param {{root: string}} ctx - CLI context.
 * @returns {Promise<string>} The scratch project.
 */
async function stage(fixture, core, ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'nina-eval-'));
  try {
    return await build(dir, fixture, core, ctx);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Fills a scratch directory with the reviewer's world; `stage` removes it if this throws. */
async function build(dir, fixture, core, ctx) {
  cpSync(join(fixture, 'base'), dir, { recursive: true });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=nina-eval', '-c', 'user.email=eval@nina.invalid', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  // The change lands on top of the commit, and the harness beside it, ignored — so the diff the
  // reviewer reads is the change alone.
  cpSync(join(fixture, 'after'), dir, { recursive: true });
  mkdirSync(join(dir, '.nina'), { recursive: true });
  writeFileSync(join(dir, '.nina', 'profile.json'), JSON.stringify(PROFILE(core), null, 2));
  const result = await composeProject(dir, ctx);
  if (result.error) throw new Error(result.error);
  if (!existsSync(join(dir, '.claude', 'agents', 'reviewer.md'))) throw new Error(`core ${core} composed no reviewer into ${dir}`);
  return dir;
}

/**
 * The command a run executes, and the environment it runs in.
 *
 * @param {{model?: string, api?: boolean}} options
 */
export function reviewerCommand({ model, api }) {
  const env = { ...process.env };
  if (!api) for (const name of BILLED) delete env[name];
  const args = [
    '-p', PROMPT,
    '--agent', 'reviewer',
    '--output-format', 'json',
    '--no-session-persistence',
    '--setting-sources', 'project',
    '--permission-mode', 'dontAsk',
    '--allowedTools', ...TOOLS,
    ...(model ? ['--model', model] : []),
  ];
  return { args, env };
}

/**
 * @param {string[]} argv - Command arguments.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function evalCommand(argv, ctx) {
  const releases = argv.flatMap((a, i) => (a === '--release' ? [argv[i + 1]] : []));
  const repeat = Number(argv.includes('--repeat') ? argv[argv.indexOf('--repeat') + 1] : 1);
  const options = {
    model: argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : undefined,
    api: argv.includes('--api'),
  };
  const dry = argv.includes('--dry-run');
  const keep = argv.includes('--keep');
  if (releases.length === 0 || !Number.isInteger(repeat) || repeat < 1) {
    console.error('  usage: nina eval --release <version> [--release <version>] [--repeat N] [--model m] [--dry-run] [--keep]\n');
    return 2;
  }

  const fixture = join(ctx.root, 'evals', 'reviewer');
  const defects = plantedDefects(fixture);
  console.log(`  ${defects.length} planted defects · ${releases.length} release(s) × ${repeat} run(s) · reviewer via \`claude -p\`` +
    (options.api ? ' with the API credentials in the environment' : ' on the login, never a per-token key') + '\n');

  // Every report is kept, whatever the grade said: a number is only as good as the text behind it, and
  // the first real run read "no verdict", which only the report itself could explain.
  const reports = mkdtempSync(join(tmpdir(), 'nina-eval-reports-'));
  const results = [];
  for (const core of releases) {
    for (let n = 1; n <= repeat; n += 1) {
      let dir;
      try {
        dir = await stage(fixture, core, ctx);
      } catch (error) {
        console.error(`  ✗ ${core}: ${error.message}`);
        return 1;
      }
      try {
        const { args, env } = reviewerCommand(options);
        let report;
        let cost = null;
        if (dry) {
          console.log(`  dry run — ${core} staged in ${dir}; would run: claude ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
          report = readFileSync(join(fixture, 'sample-report.md'), 'utf8');
        } else {
          const run = spawnSync('claude', args, { cwd: dir, env, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 });
          const failed = runFailure(run);
          // A run that did not review — not logged in, rate-limited, out of turns — is a failure to report,
          // not a review that caught nothing: graded, it would drag its release's mean down.
          if (failed) {
            console.error(`  ✗ ${core} run ${n}: ${failed}`);
            return 1;
          }
          const out = JSON.parse(run.stdout);
          report = out.result ?? '';
          cost = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null;
        }
        writeFileSync(join(reports, `${core}-${n}.md`), report);
        const graded = grade(report, defects);
        results.push({ core, n, ...graded, cost });
        console.log(
          `  ${core} run ${n}: ${graded.verdict ?? (graded.late ? `${graded.late}, but not on the first line` : 'no verdict')} · caught ${graded.caught.length}/${defects.length}` +
            ` · ${graded.other.length} other cited line(s)` +
            (graded.unlocated.length ? ` · ${graded.unlocated.length} file(s) named without a line` : '') +
            (cost !== null ? ` · $${cost.toFixed(2)} API-equivalent` : ''),
        );
      } finally {
        if (!keep) rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  console.log(`\n  reports: ${reports}`);
  for (const core of releases) {
    const runs = results.filter((r) => r.core === core);
    const mean = runs.reduce((a, r) => a + r.caught.length, 0) / runs.length;
    const always = defects.filter((d) => runs.every((r) => !r.caught.includes(d.id))).map((d) => d.id);
    console.log(`  ${core}: caught ${mean.toFixed(1)}/${defects.length} on average over ${runs.length} run(s)` + (always.length ? ` — never caught: ${always.join(', ')}` : ''));
  }
  // Each release against the first, with the widest spread any release showed between its own runs.
  const counts = releases.map((core) => results.filter((r) => r.core === core).map((r) => r.caught.length));
  const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const spread = Math.max(...counts.map((xs) => Math.max(...xs) - Math.min(...xs)));
  for (let i = 1; i < releases.length; i += 1) {
    const delta = mean(counts[i]) - mean(counts[0]);
    console.log(
      `\n  ${releases[i]} − ${releases[0]}: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} defect(s)` +
        (repeat > 1 ? `, against a run-to-run spread of ${spread} within a release` : ' — one run each cannot tell a difference from noise'),
    );
  }
  return 0;
}

/**
 * Why a `claude -p` run did not produce a review, or null when it did.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} run
 * @returns {string|null}
 */
export function runFailure(run) {
  if (run.error) return run.error.code === 'ENOENT' ? '`claude` is not on the PATH' : run.error.message;
  let out;
  try {
    out = JSON.parse(run.stdout);
  } catch {
    return `claude did not answer with JSON (exit ${run.status}) — ${String(run.stderr || run.stdout).trim().split('\n')[0]}`;
  }
  if (out.is_error || (out.subtype && out.subtype !== 'success')) {
    return `claude reported ${out.subtype ?? 'an error'}${typeof out.result === 'string' && out.result ? ` — ${out.result.split('\n')[0].slice(0, 200)}` : ''}`;
  }
  return null;
}
