#!/usr/bin/env node
/**
 * Exercises the commands that act on a project: `init`, `check`, `upgrade`, `pills` and the
 * learning report `stats` builds by crossing loop-backs with the pills they produced.
 *
 * `compose` has fixtures; these three had nothing, and both bugs they shipped with were
 * found by running them by hand — a profile whose every key came out as `{{API_DIR}}`, and
 * a checklist computed from one core while pinning another. Neither is subtle once run, and
 * neither is visible while reading.
 *
 * Each case builds a throwaway project, drives the real command, and asserts on what lands
 * on disk rather than on what was printed.
 *
 * Usage: node scripts/cli-test.mjs
 */

import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeProjectDir } from '../src/commands/stats.mjs';
import { ROLE_TOKENS, classifyVerdict, declaredIssues, isLoopBack, pillReads, scanProject, tokensOf } from '../src/transcripts.mjs';
import { applied, closeAnswered, overdue, slugFor, verified } from '../src/commands/learn.mjs';
import { parseGraph, validateGraph } from '../src/graph.mjs';
import { declaredVerdict, forwardEdges, handle, ledgerPath, loopEdges, projectGateDir, readLedger, replay, roundsFor } from '../src/gate.mjs';
import { byVersion, generatedNotice, layerRootFor, stamp, walk } from '../src/commands/compose.mjs';
import { filledSlots, projectSlots, unwiredScripts } from '../src/commands/check.mjs';
import { release } from '../src/commands/release.mjs';
import { snapshotsDir } from '../src/paths.mjs';
import { defaultVocabulary } from '../src/vocabulary.mjs';
import { costOf, priceOf } from '../src/prices.mjs';
import { GATE, applyWiring, matcherReaches, missingWiring, packageInstalled, settingsFile, shippedScripts } from '../src/wiring.mjs';

const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const NINA = join(ROOT, 'bin', 'nina.mjs');

/** A fresh empty project directory. */
const scratch = () => mkdtemp(join(tmpdir(), 'nina-cli-'));

// Every run measures into a scratch store. The detectors a composed test bed runs — the lessons
// detector snapshots, the gate's selftest checks its ledger can be written — would otherwise write
// into the real `~/.nina`, and they did: one empty ledger directory per run, per bed.
process.env.NINA_DATA = await mkdtemp(join(tmpdir(), 'nina-cli-data-'));

/**
 * Runs the CLI against a project.
 *
 * @param {string[]} args - Arguments after the command name.
 * @param {{input?: string, loud?: boolean}} [options] - `input` is piped to stdin; `loud`
 *   drops `--quiet`, which otherwise suppresses everything a detector does not need.
 * @returns {{status: number, out: string}}
 */
function run(args, options = {}) {
  const result = spawnSync(process.execPath, [NINA, ...args, ...(options.loud ? [] : ['--quiet'])], {
    encoding: 'utf8',
    input: options.input ?? '',
    cwd: ROOT,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const failures = [];
/** @param {boolean} ok @param {string} what */
const expect = (ok, what) => {
  if (!ok) failures.push(what);
};

// ─── init: the interview's answers are what lands in the profile ────────────────────────
{
  const dir = await scratch();

  // The interview asks one question per surface the pinned core HAS, in directory order, so a
  // positional answer string re-aims itself the moment a surface is added — cutting a release
  // broke this test without a line of it changing. Build the answers from the surfaces, and the
  // assertion goes back to describing the rule: what you answer is what lands in the profile.
  const newest = (await readdir(join(ROOT, 'releases'))).sort(byVersion).at(-1);
  const available = (await readdir(join(ROOT, 'releases', newest, 'surfaces'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const want = ['db', 'integrations', 'money'];
  const said = available.map((s) => (want.includes(s) ? 'y' : 'n'));
  const answers = `A lottery that registers tickets and pays winners.\n\n${said.join('\n')}\n`;

  const { status } = run(['init', '--project', dir, '--ask'], { input: answers });
  expect(status === 0, 'init: exited non-zero on an empty directory');

  const profile = JSON.parse(await readFile(join(dir, '.nina', 'profile.json'), 'utf8'));
  expect(
    JSON.stringify(profile.surfaces) === JSON.stringify(want),
    `init: answering yes to ${want.join(', ')} should select exactly those — got ${profile.surfaces.join(', ')}`,
  );

  const keys = Object.keys(profile.vocabulary);
  expect(keys.length > 0, 'init: derived no vocabulary at all');
  expect(
    keys.every((k) => /^[A-Z_]+$/.test(k)),
    `init: vocabulary keys must be bare names — got ${keys.find((k) => !/^[A-Z_]+$/.test(k))}`,
  );
  expect(
    Object.values(profile.vocabulary).every((v) => v === null),
    'init: a derived vocabulary entry must start null, so the placeholder stays visible',
  );

  const releases = (await readdir(join(ROOT, 'releases'))).sort(byVersion);
  expect(
    profile.core === releases.at(-1),
    `init: should pin the newest release (${releases.at(-1)}) — got ${profile.core}`,
  );

  const brief = await readFile(join(dir, '.nina', 'BRIEF.md'), 'utf8');
  expect(brief.includes('lottery that registers tickets'), 'init: the scope was not kept in BRIEF.md');

  const todo = await readFile(join(dir, '.nina', 'TODO.md'), 'utf8');
  expect(todo.includes('BRIEF.md'), 'init: TODO.md should send the reader to the brief first');
  expect(todo.includes('`project.1` — **title**'), 'init: TODO.md should name a slot, not only place it');
  expect(
    !/- \[ \] `project\.\d+`\n/.test(todo),
    'init: every project slot should carry a label',
  );
}

// ─── init: a surface the core offers but nobody wrote a question for ────────────────────
{
  const source = await readFile(join(ROOT, 'src', 'commands', 'init.mjs'), 'utf8');
  const asked = new Set([...source.matchAll(/^\s*'?([a-z-]+)'?:\s*'Does it/gm)].map((m) => m[1]));
  // The newest core must have a real question for every surface it offers. Older ones only
  // have to not break: a release is immutable, so a surface it names may since have been
  // renamed, and the interview falls back to a plain question rather than an empty one.
  const newest = (await readdir(join(ROOT, 'releases'))).sort(byVersion).at(-1);
  const current = (await readdir(join(ROOT, 'releases', newest, 'surfaces'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const s of current) {
    expect(asked.has(s), `init: core ${newest} offers "${s}" but the interview has no question for it`);
  }

  const dir = await scratch();
  const { out } = run(['init', '--project', dir, '--core', (await readdir(join(ROOT, 'releases'))).sort(byVersion)[0], '--ask'], {
    input: 'x\n\nn\nn\nn\nn\nn\nn\n',
  });
  expect(!/—\s*$/m.test(out), 'init: an older core must never render an empty question');
}

// ─── check: a project that still has the directory under its old name ──────────────────
{
  const dir = await scratch();
  await mkdir(join(dir, '.harness'), { recursive: true });
  await writeFile(join(dir, '.harness', 'profile.json'), '{}');
  const { out } = run(['check', '--project', dir]);
  expect(
    out.includes('still has .harness/') && out.includes('Rename it; do not start over.'),
    `check: should recognise the old directory name — got ${out.trim()}`,
  );
  expect(
    !out.includes('run `nina init` first'),
    'check: a project with the old directory has a profile already — telling it to init would write a second one',
  );

  const fresh = await scratch();
  expect(
    run(['check', '--project', fresh]).out.includes('run `nina init` first'),
    'check: a project with neither directory is a new one, and should be told to init',
  );
}

// ─── check: vocabulary the project's own layer uses is not unused ──────────────────────
{
  const dir = await scratch();
  await cp(join(ROOT, 'fixtures', 'plain', '.nina'), join(dir, '.nina'), { recursive: true });
  const path = join(dir, '.nina', 'profile.json');
  const profile = JSON.parse(await readFile(path, 'utf8'));
  profile.vocabulary.PROJECT_ONLY = 'something';
  await writeFile(path, JSON.stringify(profile, null, 2));

  // Nothing in the core says PROJECT_ONLY; a project fragment does.
  const frag = join(dir, '.nina', 'project', 'tree', '.claude', 'agents', 'reviewer.md');
  await mkdir(dirname(frag), { recursive: true });
  await writeFile(frag, '<!-- nina:slot project.1 -->\nWritten for {{PROJECT_ONLY}}.\n');

  expect(
    !run(['check', '--project', dir]).out.includes('{{PROJECT_ONLY}} is declared but nothing references it'),
    'check: vocabulary a project fragment uses is referenced — saying otherwise invites deleting it',
  );

  const releases = (await readdir(join(ROOT, 'releases'))).sort(byVersion);
  const { out } = run(['upgrade', '--project', dir, '--to', releases.at(-1)]);
  expect(
    !/nothing in .* references:.*PROJECT_ONLY/.test(out),
    `upgrade: should not offer to drop vocabulary the project itself uses — got ${out.trim()}`,
  );
}

// ─── check: the documents the layers read but no layer writes ──────────────────────────
{
  const dir = await scratch();
  await cp(join(ROOT, 'fixtures', 'plain', '.nina'), join(dir, '.nina'), { recursive: true });
  const { out } = run(['check', '--project', dir]);
  expect(
    /\.claude\/architecture\.md does not exist, and the chosen layers tell an agent to read it \d+ time\(s\)/.test(out),
    `check: should ask for a document the layers reference and nobody supplies — got ${out.trim()}`,
  );

  // Writing it answers the question; nothing else about the project changed.
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(join(dir, '.claude', 'architecture.md'), '# Architecture\n');
  expect(
    !run(['check', '--project', dir]).out.includes('architecture.md does not exist'),
    'check: should stop asking once the document exists',
  );

  // It is derived from what the layers say, so it must never name a file a layer provides.
  expect(
    !run(['check', '--project', dir]).out.includes('.claude/patterns.md does not exist'),
    'check: should not ask the project for a file the core composes',
  );
}

// ─── check: says what is wrong, and is quiet when nothing is ────────────────────────────
{
  const dir = await scratch();
  await mkdir(join(dir, '.nina', 'project', 'tree'), { recursive: true });
  await writeFile(
    join(dir, '.nina', 'profile.json'),
    JSON.stringify({
      core: 'dev',
      surfaces: ['integrations', 'invented'],
      integrations: [{ slug: 'stripe', name: 'Stripe', kind: 'wishful', boundary: 'packages/stripe' }],
      vocabulary: {},
    }),
  );
  const { status, out } = run(['check', '--project', dir]);
  expect(status === 1, 'check: a broken profile should exit 1');
  expect(out.includes('invented'), 'check: should name a surface the core does not have');
  expect(out.includes('kind "wishful"'), 'check: should reject an unknown integration kind');
  expect(out.includes('.claude/integrations/stripe.md'), 'check: should want a doc for a declared integration');
  expect(out.includes('project slot(s) have no fragment'), 'check: should count the unfilled project layer');
}

// ─── upgrade: refuses while the project would lose text it wrote ────────────────────────
{
  const releases = (await readdir(join(ROOT, 'releases'))).sort(byVersion);
  const [oldest, newest] = [releases[0], releases.at(-1)];
  const dir = await scratch();
  await mkdir(join(dir, '.nina', 'project', 'tree', '.claude', 'agents'), { recursive: true });
  const surfaces = (await readdir(join(ROOT, 'releases', oldest, 'surfaces'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  await writeFile(
    join(dir, '.nina', 'profile.json'),
    JSON.stringify({ core: oldest, surfaces, vocabulary: {} }),
  );
  await writeFile(
    join(dir, '.nina', 'project', 'tree', '.claude', 'agents', 'integration-tester.md'),
    '<!-- nina:slot project.1 -->\nText this project wrote.\n',
  );

  const dry = run(['upgrade', '--project', dir, '--to', newest]);
  expect(dry.status === 1, `upgrade: ${oldest} → ${newest} drops a surface, so the dry run should exit 1`);
  expect(dry.out.includes('do not exist in'), 'upgrade: should name the surfaces that are gone');
  expect(dry.out.includes('fill slots'), 'upgrade: should name the fragments that would compose to nothing');
  expect(
    JSON.parse(await readFile(join(dir, '.nina', 'profile.json'), 'utf8')).core === oldest,
    'upgrade: a dry run must not write anything',
  );

  const refused = run(['upgrade', '--project', dir, '--to', newest, '--apply']);
  expect(refused.status === 1, 'upgrade: --apply should still refuse while something would lose meaning');
  expect(
    JSON.parse(await readFile(join(dir, '.nina', 'profile.json'), 'utf8')).core === oldest,
    'upgrade: a refused --apply must not write anything',
  );

  // Hooks the move needs are not something --force skips — `wire` writes them first; a manifest this
  // bare project has none of is left for --force to accept.
  run(['wire', '--project', dir, '--to', newest, '--apply']);
  const forced = run(['upgrade', '--project', dir, '--to', newest, '--apply', '--force']);
  expect(forced.status === 0, `upgrade: --force should apply — got ${forced.out}`);
  expect(
    JSON.parse(await readFile(join(dir, '.nina', 'profile.json'), 'utf8')).core === newest,
    'upgrade: --force should have pinned the new version',
  );
}

/**
 * A project pinned to `core` that `check` actually passes: every project slot filled, and
 * every document the layers read created.
 *
 * This exists because the clean-move test below used to pin a bare `.nina/`, which leaves
 * `check` failing at the baseline — and `--apply` reports a validation that was already
 * failing rather than rolling back for it. So the only test that drove the chain drove it with
 * every validation pre-excused, and a move that breaks `check` shipped anyway. A test bed has
 * to be sound before it can tell you anything about what breaks it.
 *
 * @param {string} fixture - Which fixture's profile to start from.
 * @param {string} core - The release to pin.
 * @returns {Promise<string>} The project directory.
 */
async function sound(fixture, core) {
  const dir = await scratch();
  await cp(join(ROOT, 'fixtures', fixture, '.nina'), join(dir, '.nina'), { recursive: true });
  const path = join(dir, '.nina', 'profile.json');
  const profile = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, `${JSON.stringify({ ...profile, core }, null, 2)}\n`);

  const { dir: layers } = layerRootFor(ROOT, core);
  const done = await filledSlots(dir);
  const open = [...(await projectSlots(layers, profile.surfaces ?? []))].filter((s) => !done.has(s));
  const byFile = new Map();
  for (const s of open) {
    const cut = s.lastIndexOf(' ');
    const rel = s.slice(0, cut);
    byFile.set(rel, [...(byFile.get(rel) ?? []), s.slice(cut + 1)]);
  }
  for (const [rel, ids] of byFile) {
    const file = join(dir, '.nina', 'project', 'tree', rel);
    await mkdir(dirname(file), { recursive: true });
    // A fragment lands inside the file it fills, so a slot in a script has to be filled with
    // something a script can contain. Prose there is a syntax error, and the detector that
    // imports it reports the crash rather than the drift it was built to find.
    const body = /\.(mjs|cjs|js)$/.test(rel) ? '// Owned by the project.' : 'Owned by the project.';
    await writeFile(file, ids.map((id) => `<!-- nina:slot ${id} -->\n${body}\n`).join('\n'));
  }
  // Whatever the layers read but no layer writes, asked for rather than listed, so a new
  // reference in the core starts being created here on its own.
  for (const line of run(['check', '--project', dir], { loud: true }).out.split('\n')) {
    const owed = /✗ (\S+) does not exist/.exec(line);
    if (!owed) continue;
    await mkdir(dirname(join(dir, owed[1])), { recursive: true });
    await writeFile(join(dir, owed[1]), `# ${owed[1]}\n`);
  }

  // The bed declares the one detector every composed project has, and installs this checkout
  // where a real project's dependency would be. Without it `--apply` skips its last step as
  // not applicable — which is how a deadlock in that step shipped days after the same deadlock
  // in the step before it was found and fixed. A test bed missing a step tests the steps it has.
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'nina-test-bed',
        private: true,
        scripts: {
          'harness:check': 'node scripts/harness-check.mjs',
          'harness:compose:check': 'nina compose --check --quiet',
        },
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(dir, 'node_modules', '@xhulz'), { recursive: true });
  await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
  await symlink(ROOT, join(dir, 'node_modules', '@xhulz', 'nina'));
  await symlink(join(ROOT, 'bin', 'nina.mjs'), join(dir, 'node_modules', '.bin', 'nina'));
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(join(dir, '.claude', 'settings.json'), settingsFile());
  // Composed, because `check` now reads what was composed — the graph and the specs — as well as
  // what was declared. The bed was never composed, and passed only while the newest release had no
  // graph for `check` to ask about; the first release with one failed it.
  run(['compose', '--project', dir]);
  return dir;
}

// ─── init: the wiring that runs the check, written where it can be and asked for where not ───
{
  // A project with no settings gets both hooks; its package.json gains the scripts and keeps the rest.
  const installed = async (dir) => {
    await mkdir(join(dir, 'node_modules', '@xhulz'), { recursive: true });
    await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
    await symlink(ROOT, join(dir, 'node_modules', '@xhulz', 'nina'));
    await symlink(join(ROOT, 'bin', 'nina.mjs'), join(dir, 'node_modules', '.bin', 'nina'));
  };
  const fresh = await scratch();
  await writeFile(join(fresh, 'package.json'), '{\n\t"name": "fresh",\n\t"scripts": { "build": "tsc" }\n}\n');
  await installed(fresh);
  const began = run(['init', '--project', fresh, '--surfaces', '', '--no-ask'], { loud: true });
  expect(began.status === 0, 'init: a fresh project initialises');
  // Composed at once, so the hooks it wired have something to run from the first session.
  expect(
    existsSync(join(fresh, 'CLAUDE.md')) && existsSync(join(fresh, 'scripts', 'harness-check.mjs')) && began.out.includes('open Claude Code here'),
    `init: composes the harness, holes and all, and points at the first session — got ${began.out}`,
  );
  const settings = JSON.parse(await readFile(join(fresh, '.claude', 'settings.json'), 'utf8').catch(() => '{}'));
  const pkg = JSON.parse(await readFile(join(fresh, 'package.json'), 'utf8'));
  expect(
    String(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).includes('--hook') &&
      String(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).includes('--context'),
    `init: a project with no settings gets both hooks — got ${JSON.stringify(settings)}`,
  );
  expect(
    pkg.scripts?.build === 'tsc' && pkg.scripts?.['harness:check'] && pkg.scripts?.['harness:compose:check'] &&
      (await readFile(join(fresh, 'package.json'), 'utf8')).includes('\t"name"'),
    `init: package.json gains the scripts, keeps its own and its indentation — got ${JSON.stringify(pkg)}`,
  );
  expect((await readFile(join(fresh, '.nina', 'TODO.md'), 'utf8')).includes('## 4. Wiring — done'), 'init: TODO says the wiring is done when it is');

  // Without the package, every hook would fail to load. Said first, by init and by check.
  const bare = await scratch();
  await writeFile(join(bare, 'package.json'), '{\n  "name": "bare"\n}\n');
  const uninstalled = run(['init', '--project', bare, '--surfaces', '', '--no-ask'], { loud: true });
  expect(
    uninstalled.out.includes('first:     install @xhulz/nina') && (await readFile(join(bare, '.nina', 'TODO.md'), 'utf8')).includes('@xhulz/nina is not installed'),
    `init: a project without the package is told to install it before anything else — got ${uninstalled.out}`,
  );
  expect(run(['check', '--project', bare], { loud: true }).out.includes('@xhulz/nina is not installed'), 'check: and so is every later check');
  // And the hooks themselves, which used to fail without a word: each one that matters says why.
  const bareSettings = JSON.parse(await readFile(join(bare, '.claude', 'settings.json'), 'utf8'));
  const hookSays = (event) => {
    const cmd = bareSettings.hooks[event].flatMap((g) => g.hooks.map((h) => h.command))[0];
    const r = spawnSync('sh', ['-c', cmd], { input: '{}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: bare, PATH: '/usr/bin:/bin:' + dirname(process.execPath) } });
    try {
      return { status: r.status, answer: JSON.parse(r.stdout) };
    } catch {
      return { status: r.status, answer: null };
    }
  };
  const stopSaid = hookSays('Stop');
  const promptSaid = hookSays('UserPromptSubmit');
  expect(
    stopSaid.status === 0 && String(stopSaid.answer?.systemMessage).includes('@xhulz/nina') &&
      String(promptSaid.answer?.hookSpecificOutput?.additionalContext).includes('could not start'),
    `hooks: a script that cannot load says so, to the person and to the model — got ${JSON.stringify(stopSaid)} ${JSON.stringify(promptSaid)}`,
  );

  // The first prompt in a new project: what reaches the model is what is missing and where to fill it
  // from — once, from the declaration detector, not 57 slot lines under a hint about hand edits.
  const data = await scratch();
  const before = process.env.NINA_DATA;
  process.env.NINA_DATA = data;
  const first = await scratch();
  await writeFile(join(first, 'package.json'), '{\n  "name": "first"\n}\n');
  await installed(first);
  run(['init', '--project', first, '--core', 'dev', '--surfaces', '', '--no-ask']);
  const told = spawnSync(process.execPath, [join(first, 'scripts', 'harness-check.mjs'), '--context'], {
    cwd: first,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(first, 'node_modules', '.bin')}:${process.env.PATH}` },
  });
  let context = '';
  try {
    context = JSON.parse(told.stdout).hookSpecificOutput.additionalContext;
  } catch {
    // Reported below.
  }
  expect(
    context.includes('declaration:') && context.includes('.nina/TODO.md') && context.includes('project slot(s) have no fragment') && !context.includes('slot(s) have no fragment in a declared layer'),
    `init: the first prompt is told what to fill and where from, once — got ${context || told.stdout + told.stderr}`,
  );
  if (before === undefined) delete process.env.NINA_DATA;
  else process.env.NINA_DATA = before;

  // Settings that exist are the project's: never edited, and what they lack is asked for.
  const owned = await scratch();
  await mkdir(join(owned, '.claude'), { recursive: true });
  const theirs = '{ "permissions": { "allow": [] } }\n';
  await writeFile(join(owned, '.claude', 'settings.json'), theirs);
  run(['init', '--project', owned, '--surfaces', '', '--no-ask']);
  expect((await readFile(join(owned, '.claude', 'settings.json'), 'utf8')) === theirs, 'init: an existing settings.json is never rewritten');
  const todo = await readFile(join(owned, '.nina', 'TODO.md'), 'utf8');
  expect(todo.includes('no UserPromptSubmit hook') && todo.includes('package.json does not exist'), `init: what it could not wire is left in TODO\n${todo}`);
  const asked = run(['check', '--project', owned], { loud: true });
  expect(asked.status === 1 && asked.out.includes('no UserPromptSubmit hook'), `check: missing wiring is a problem — got ${asked.status}`);
}

// ─── check: a slot the caller says the move just created is work, not a fault ───────────
{
  const newest = (await readdir(join(ROOT, 'releases'))).sort(byVersion).at(-1);
  const dir = await sound('plain', newest);
  expect(run(['check', '--project', dir], { loud: true }).status === 0, 'check: the test bed should be sound');

  // Empty one fragment so exactly one slot is open, and name it.
  const { dir: layers } = layerRootFor(ROOT, newest);
  const slot = [...(await projectSlots(layers, []))].find((s) => s.startsWith('CLAUDE.md '));
  const frag = join(dir, '.nina', 'project', 'tree', 'CLAUDE.md');
  const kept = (await readFile(frag, 'utf8')).replace(
    `<!-- nina:slot ${slot.split(' ').at(-1)} -->\nOwned by the project.\n`,
    '',
  );
  await writeFile(frag, kept);

  const bare = run(['check', '--project', dir], { loud: true });
  expect(bare.status === 1, 'check: an unfilled project slot is a problem when nobody says otherwise');

  const told = run(['check', '--project', dir, '--expect-unfilled', slot], { loud: true });
  expect(told.status === 0, `check: --expect-unfilled should excuse exactly ${slot}`);
  expect(told.out.includes('is new in this core and still to fill'), 'check: and should still say it is owed');

  const other = run(['check', '--project', dir, '--expect-unfilled', 'CLAUDE.md project.999'], { loud: true });
  expect(other.status === 1, 'check: naming a different slot must not excuse this one');
}

// ─── upgrade: a clean move writes exactly one field ─────────────────────────────────────
{
  const releases = (await readdir(join(ROOT, 'releases'))).sort(byVersion);
  const [from, to] = [releases.at(-2), releases.at(-1)];
  if (from && to && from !== to) {
    const dir = await sound('plain', from);
    const path = join(dir, '.nina', 'profile.json');
    const before = JSON.parse(await readFile(path, 'utf8'));
    // A slot the move itself introduces cannot be filled before the core that introduces it is
    // pinned, so failing on one leaves no order in which the upgrade can ever complete.
    const { status, out } = run(['upgrade', '--project', dir, '--to', to, '--apply'], { loud: true });
    expect(status === 0, `upgrade: ${from} → ${to} on a sound project should apply, not roll back`);
    expect(!out.includes('rolling back'), `upgrade: ${from} → ${to} must not roll back for a slot it created itself`);
    const created = /· (\d+) new project slot\(s\) to fill/.exec(out);
    expect(
      !created || out.includes('still to fill — only this project can write them'),
      'upgrade: a move that creates slots must say so after it succeeds, not only before',
    );
    expect(
      out.includes("running the project's own detectors") && !out.includes('detectors — not applicable'),
      'upgrade: the bed must actually run the project detectors, or this proves nothing about them',
    );
    const after = JSON.parse(await readFile(path, 'utf8'));
    expect(after.core === to, 'upgrade: should pin the new version');
    expect(
      JSON.stringify({ ...after, core: null }) === JSON.stringify({ ...before, core: null }),
      'upgrade: should change the version and nothing else',
    );
  }
}

// ─── upgrade: a slot the move itself creates must not deadlock the move ─────────────────
/**
 * Built against two releases this test cuts itself, because the mechanism must hold for any
 * pair and the newest real pair may happen not to exercise it — 0.16.1 was a compiler-only cut,
 * so its layers are byte-identical to 0.16.0 and it introduces no slot at all. A test that
 * quietly stops testing is worse than one that fails.
 *
 * The project carries the detector every composed project has, because the deadlock was fixed
 * in `check` and shipped anyway in `compose --check`, which is reached only through the
 * project's own `harness:check`.
 */
{
  const nina = await scratch();
  await cp(join(ROOT, 'bin'), join(nina, 'bin'), { recursive: true });
  await cp(join(ROOT, 'src'), join(nina, 'src'), { recursive: true });
  await writeFile(
    join(nina, 'package.json'),
    `${JSON.stringify(
      {
        name: '@xhulz/nina',
        version: '0.0.0',
        type: 'module',
        exports: { './detectors': './src/detectors.mjs', './package.json': './package.json' },
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(nina, 'surfaces'), { recursive: true });
  await mkdir(join(nina, 'core', 'tree', 'scripts'), { recursive: true });
  await writeFile(join(nina, 'core', 'tree', 'CLAUDE.md'), '# Bed\n\n<!-- nina:slot project.1 intro -->\n');
  await writeFile(
    join(nina, 'core', 'tree', 'scripts', 'harness-check.mjs'),
    [
      '#!/usr/bin/env node',
      "import { runDetectors } from '@xhulz/nina/detectors';",
      'process.exit(',
      '  runDetectors(',
      "    [{ name: 'agent specs', declaredBy: 'harness:compose:check', bin: 'nina',",
      "       args: ['compose', '--check', '--quiet'], ignore: /^compose: current$/ }],",
      '    { root: process.cwd() },',
      '  ),',
      ');',
      '',
    ].join('\n'),
  );

  const quiet = async (version) => {
    const log = console.log;
    console.log = () => {};
    await release([version], { root: nina });
    console.log = log;
  };
  await quiet('1.0.0');
  // The move that introduces a slot the project cannot possibly have filled yet.
  await writeFile(
    join(nina, 'core', 'tree', 'CLAUDE.md'),
    '# Bed\n\n<!-- nina:slot project.1 intro -->\n\n<!-- nina:slot project.2 added -->\n',
  );
  await quiet('1.1.0');

  const dir = await scratch();
  await mkdir(join(dir, '.nina', 'project', 'tree'), { recursive: true });
  await writeFile(
    join(dir, '.nina', 'profile.json'),
    `${JSON.stringify({ core: '1.0.0', surfaces: [], vocabulary: {} }, null, 2)}\n`,
  );
  await writeFile(join(dir, '.nina', 'project', 'tree', 'CLAUDE.md'), '<!-- nina:slot project.1 -->\nOurs.\n');
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'bed',
        private: true,
        scripts: {
          'harness:check': 'node scripts/harness-check.mjs',
          'harness:compose:check': 'nina compose --check --quiet',
        },
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(dir, 'node_modules', '@xhulz'), { recursive: true });
  await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
  await symlink(nina, join(dir, 'node_modules', '@xhulz', 'nina'));
  await symlink(join(nina, 'bin', 'nina.mjs'), join(dir, 'node_modules', '.bin', 'nina'));
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(join(dir, '.claude', 'settings.json'), settingsFile());

  /** @param {string[]} args */
  const bed = (args) => {
    const r = spawnSync(process.execPath, [join(nina, 'bin', 'nina.mjs'), ...args, '--quiet'], {
      encoding: 'utf8',
      cwd: dir,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  expect(bed(['compose', '--project', dir]).status === 0, 'deadlock: the bed should compose at 1.0.0');
  expect(bed(['check', '--project', dir]).status === 0, 'deadlock: the bed should be sound at 1.0.0');

  const moved = bed(['upgrade', '--project', dir, '--to', '1.1.0', '--apply']);
  expect(moved.status === 0, `deadlock: a move that creates a slot must apply — got ${moved.status}\n${moved.out}`);
  expect(!moved.out.includes('rolling back'), `deadlock: and must not roll back\n${moved.out}`);
  expect(
    moved.out.includes("running the project's own detectors") && !moved.out.includes('detectors — not applicable'),
    'deadlock: the project detectors must actually run, or this proves nothing about compose --check',
  );
  expect(
    JSON.parse(await readFile(join(dir, '.nina', 'profile.json'), 'utf8')).core === '1.1.0',
    'deadlock: the pin should have moved',
  );
  expect(moved.out.includes('CLAUDE.md project.2'), 'deadlock: the move should name what is still owed');

  // The exemption lasts exactly as long as the move: the next run reports the slot again.
  const after = spawnSync(process.execPath, [join(dir, 'scripts', 'harness-check.mjs')], {
    encoding: 'utf8',
    cwd: dir,
    env: { ...process.env, PATH: `${join(dir, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` },
  });
  expect(after.status === 1, 'deadlock: the detector must report the open slot once the move is over');

  // The move after that one. The slot is still open, so the detectors are still failing — but
  // this move did not create it, and a step the project was already failing is reported rather
  // than rolled back for. That rule was written for the validations and the detector step was
  // left out of it, so `check` was excused while the detectors, reading the very same fact
  // through a different command, put the whole move back.
  await quiet('1.2.0');
  const inherited = bed(['upgrade', '--project', dir, '--to', '1.2.0', '--apply']);
  expect(
    inherited.status === 0,
    `deadlock: a move must not roll back for a failure it inherited — got ${inherited.status}\n${inherited.out}`,
  );
  expect(
    /detectors — still failing, as it was before the upgrade/.test(inherited.out),
    `deadlock: and must say the detectors were already failing, not that they passed\n${inherited.out}`,
  );
  expect(
    JSON.parse(await readFile(join(dir, '.nina', 'profile.json'), 'utf8')).core === '1.2.0',
    'deadlock: an inherited failure must not have put the pin back',
  );
}

// ─── the notice: routes, rather than only forbidding ───────────────────────────────────
{
  const notice = generatedNotice('.claude/agents/qa.md', ['project.2 role-intro', 'project.1 description']);
  expect(notice.includes('project.1 description'), 'notice: should name each slot with its label');
  expect(
    notice.indexOf('project.1') < notice.indexOf('project.2'),
    'notice: slots read by number, not by where they happen to sit in the core file',
  );
  expect(notice.includes('.nina/profile.json'), 'notice: should send an upstream change to the pinned version');
  // Embedding the version instead would rewrite the notice in every composed file on every
  // upgrade, so a project's diff after a move would be twenty files of stamp and one of
  // substance — the hazard CLAUDE.md already names for a rarer trigger.
  expect(!/\d+\.\d+\.\d+/.test(notice), 'notice: must not embed the pinned version itself');
  expect(
    generatedNotice('.claude/pills/README.md', []).includes('no project-layer slot'),
    'notice: and says so plainly where the project may change nothing',
  );

  // The notice sits above the title of the one file Claude Code always loads, and nothing has
  // ever bounded it: at eight slots it is already 9 of that file's 203 lines, and every line
  // added pushes the hard rules further from the top. A ceiling that fails here is the only
  // thing that stops it growing a line at a time, each addition looking cheap on its own.
  // Measured with no slots at all, so a core file that legitimately gains one is not mistaken
  // for the thing being bounded: a sentence added to the FIXED text, which lands on every
  // composed file of every project at once and reads as cheap on its own every single time.
  //
  // In characters, not lines. Lines are what a reader feels, but the 88-column wrap carries
  // slack on its last line, so a whole added clause can land without the line count moving —
  // measured: a 110-character sentence left both the 6-line and the 11-line counts untouched.
  // A ceiling that a change can slip under is worse than none, because it reads as a check.
  const boilerplate = generatedNotice('.claude/pills/README.md', []).length;
  expect(
    boilerplate <= 500,
    `notice: the fixed text must stay within 500 characters — got ${boilerplate}. It sits above
     the title of the one file that is always loaded, on every composed file of every project.
     Adding to it is not free; put the pointer in a command's output instead.`,
  );
}

// ─── where: the layer a path belongs to, for the cases the notice cannot reach ─────────
{
  const newest = (await readdir(join(ROOT, 'releases'))).sort(byVersion).at(-1);
  const dir = await sound('plain', newest);

  const composed = run(['where', 'CLAUDE.md', '--project', dir]);
  expect(composed.status === 0, 'where: a classification is an answer, not a failure');
  expect(/project\.\d+ [a-z]/.test(composed.out), 'where: should name the slots with their labels');
  expect(composed.out.includes('where: generated'), 'where: should say a composed file is composed');

  // The notice is printed by calling generatedNotice, never by restating it: two copies of
  // one fact drifting apart is a bug this repo has already shipped once, and a command whose
  // whole job is to be trusted about where things go is the worst place for a second.
  const owned = run(['where', '.claude/pills/README.md', '--project', dir]);
  expect(owned.out.includes('no project slot'), 'where: should say when the project may change nothing');
  expect(
    owned.out.includes(generatedNotice('.claude/pills/README.md', []).split('\n')[1].trim()),
    "where: should print the file's own notice rather than a second wording of it",
  );

  const gated = run(['where', '.claude/agents/solidity-dev.md', '--project', dir]);
  expect(gated.out.includes('gated (needs blockchain)'), 'where: a file gated on an undeclared surface is not missing');

  await mkdir(join(dir, '.claude', 'pills', 'qa'), { recursive: true });
  await writeFile(join(dir, '.claude', 'pills', 'qa', 'x.md'), '# x\n');
  expect(
    run(['where', '.claude/pills/qa/x.md', '--project', dir]).out.includes('(pill)'),
    "where: a pill is the project's own, and no compose writes it",
  );

  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'index.ts'), 'export const x = 1;\n');
  expect(
    run(['where', 'src/index.ts', '--project', dir]).out.includes('not harness'),
    "where: ordinary code is not the harness's business",
  );

  expect(run(['where', '../outside.md', '--project', dir]).status === 1, 'where: must refuse a path outside the project');
  expect(run(['where', '--project', dir]).status === 2, 'where: no path given is a usage error');
  expect(run(['where', 'CLAUDE.md', '--project', await scratch()]).status === 1, 'where: no profile is an environment failure');
}

// ─── verdicts: every token a spec tells a stage to emit is one the parser can read ─────
{
  // The declared line reads any token. The fallback is for the report that skipped it, and it
  // knew every gate's tokens and none of the writing stages' — so their loop-back rate was not
  // low, it was unmeasured, and nothing distinguished the two.
  for (const token of ['DIFF-READY', 'SPEC-READY', 'PLAN-READY', 'DEPLOYED', 'APPROVED', 'PASS', 'SECURE']) {
    const got = classifyVerdict(`## Summary\n\nThe work is ${token} — details below.`).verdict;
    expect(got === token, `verdict: an undeclared ${token} should still be read — got ${got}`);
    expect(!isLoopBack(got), `verdict: ${token} is not a loop-back`);
  }
  // A rejection outranks a success named in the same report: it describes a failure it explains.
  expect(
    classifyVerdict('Not DIFF-READY: BLOCKED on a missing premise.').verdict === 'BLOCKED',
    'verdict: BLOCKED must outrank a success token in the same report',
  );
  expect(classifyVerdict('VERDICT: SPEC-READY\nbody').source === 'declared', 'verdict: the declared line wins');

  // The fallback reads a role's own tokens only. Reproduced by an audit: the implementer is told to
  // report "typecheck, lint and build: PASS", and PASS is qa's word.
  const implementer = 'Typecheck, lint, and build all PASSED for the affected packages.\nDIFF-READY for review.';
  expect(classifyVerdict(implementer, 'implementer').verdict === 'DIFF-READY', 'verdict: an implementer saying PASS about its build is not a qa verdict');
  expect(classifyVerdict('All green: PASS', 'qa').verdict === 'PASS', 'verdict: qa saying PASS still is');

  // The per-role map restates the specs, so it is checked against them.
  for (const file of await readdir(join(ROOT, 'core', 'tree', '.claude', 'agents'))) {
    const role = file.replace(/\.md$/, '');
    const spec = await readFile(join(ROOT, 'core', 'tree', '.claude', 'agents', file), 'utf8');
    const line = spec.split('\n').find((l) => l.includes('`<TOKEN>` is one of')) ?? '';
    const declared = [...line.matchAll(/`([A-Z][A-Z-]+)`/g)].map((m) => m[1]).sort().join();
    expect(
      (ROLE_TOKENS[role] ?? []).slice().sort().join() === declared,
      `verdict: ROLE_TOKENS.${role} is ${ROLE_TOKENS[role]} but its spec declares ${declared}`,
    );
  }

  // Every token a composed spec tells its stage to emit must be one of the above. Read from the
  // specs rather than listed here, so a new token in a spec fails this until the parser knows it.
  const emitted = new Set();
  for (const file of await readdir(join(ROOT, 'core', 'tree', '.claude', 'agents'))) {
    const spec = await readFile(join(ROOT, 'core', 'tree', '.claude', 'agents', file), 'utf8');
    // Each spec states its set once, in the verdict section: "where `<TOKEN>` is one of `A` or `B`".
    for (const line of spec.split('\n').filter((l) => l.includes('`<TOKEN>` is one of'))) {
      for (const m of line.matchAll(/`([A-Z][A-Z-]+)`/g)) emitted.add(m[1]);
    }
  }
  // Nine distinct specs, ten distinct tokens today. A floor rather than an exact count, so a new
  // role is not a test edit — but low enough reading would mean the pattern stopped matching.
  expect(emitted.size >= 8, `verdict: should read every spec's token set — found ${[...emitted].join(', ')}`);
  for (const token of emitted) {
    const got = classifyVerdict(`Report.\n\nOutcome: ${token}.`).verdict;
    expect(got === token, `verdict: a spec emits ${token}, which the fallback cannot read — got ${got}`);
  }
}

// ─── issues: a report that sends work back names what it sends back ─────────────────────
{
  const ids = (text) => JSON.stringify(declaredIssues(text));
  expect(ids('VERDICT: REJECTED\nISSUES: missing-null-check, wrong-error-status\nbody') === '["missing-null-check","wrong-error-status"]', 'issues: the line under the verdict is read');
  // The id is written by a model: the same issue spelled a little differently is still the same issue.
  expect(ids('VERDICT: FAIL\n\nISSUES: Order Total_Test red; `order-total-test-red`') === '["order-total-test-red"]', 'issues: case, spaces, backticks and repeats do not make a new id');
  expect(declaredIssues(`VERDICT: REJECTED\nISSUES: ${'x'.repeat(30)}-${'y'.repeat(30)}`)[0].length <= 40, 'issues: an id is a label, and is cut to one');
  expect(ids('VERDICT: REJECTED\nISSUES:') === '[]', 'issues: an empty line names nothing');
  // The position is read as strictly as the verdict's: a line further down is prose, not a declaration.
  expect(declaredIssues('VERDICT: REJECTED\nthe owner is implementer\nISSUES: a') === null, 'issues: only the line directly under the verdict counts');
  expect(declaredIssues('Rejected.\nISSUES: a') === null, 'issues: a report with no declared verdict declares no issues');
  expect(ids('VERDICT: REJECTED\r\nISSUES: a, b\r\nbody') === '["a","b"]', 'issues: a report with CRLF line ends reads the same');
  expect(ids('VERDICT: REJECTED\nISSUES:\n- missing-null-check\n* wrong status\n1. índice-ausente\n\nbody\n- not-an-issue') === '["missing-null-check","wrong-status","indice-ausente"]', 'issues: a bulleted list under an empty ISSUES line is read, up to the first line that is not an item');
  expect(ids('VERDICT: REJECTED\nISSUES: none') === '[]' && ids('VERDICT: FAIL\nISSUES: n/a') === '[]', 'issues: "none" names nothing');
  expect(declaredIssues(`VERDICT: REJECTED\nISSUES: ${Array.from({ length: 30 }, (_, i) => `i${i}`).join(', ')}`).length === 20, 'issues: a report keeps at most 20 ids — labels, not the report');
  // Decisions recorded as tests: a header in another order, or in bold, declares nothing — as for the verdict.
  expect(declaredIssues('VERDICT: REJECTED\nOwner: implementer\nISSUES: a') === null, 'issues: an owner line put first hides the ids (the round is counted by its edge)');
  expect(declaredIssues('VERDICT: REJECTED\n**ISSUES:** a') === null, 'issues: a bold ISSUES line is not the declared one');

  // Every spec asks for the line under the verdict that sends work back, with an example the parser reads
  // as written — a format the specs teach and the parser does not read would be followed and then lost.
  for (const file of await readdir(join(ROOT, 'core', 'tree', '.claude', 'agents'))) {
    const role = file.replace(/\.md$/, '');
    const spec = await readFile(join(ROOT, 'core', 'tree', '.claude', 'agents', file), 'utf8');
    const back = (ROLE_TOKENS[role] ?? []).find(isLoopBack);
    const example = new RegExp(`^VERDICT: ${back}\\n(ISSUES: .+)$`, 'm').exec(spec);
    expect(Boolean(example), `issues: ${role}'s spec shows the ISSUES line under \`VERDICT: ${back}\``);
    if (!example) continue;
    const written = example[1].slice('ISSUES: '.length).split(', ');
    expect(ids(`VERDICT: ${back}\n${example[1]}`) === JSON.stringify(written), `issues: ${role}'s example ids read back exactly as written — got ${ids(`VERDICT: ${back}\n${example[1]}`)}`);
  }
}

// ─── learn: the cycle, link by link ─────────────────────────────────────────────────────
{
  // apply: only a read counts as a read. Shapes taken from real subagent transcripts, including the
  // two an audit found the first version crediting: a bare listing, and a Write that cites a pill.
  const call = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  const reads = (name, input) => pillReads(call(name, input));
  expect(reads('Read', { file_path: '/p/.claude/pills/qa/a.md' }).read.join() === 'qa/a.md', 'learn: a Read of a pill is a read');
  expect(reads('Bash', { command: 'cat .claude/pills/qa/a.md' }).read.join() === 'qa/a.md', 'learn: a cat of a pill is a read');
  expect(reads('Bash', { command: 'head -20 .claude/pills/shared/*.md' }).read.join() === '(glob)', 'learn: a head over a glob dumps content — a read');
  const ls = reads('Bash', { command: 'ls -la .claude/pills/qa/' });
  expect(ls.read.length === 0 && ls.listed, 'learn: an ls is a listing, not a read');
  expect(reads('Glob', { pattern: '.claude/pills/qa/*.md' }).read.length === 0, 'learn: a Glob is a listing, not a read');
  const cites = reads('Write', { file_path: '/p/spec.md', content: 'per .claude/pills/shared/b.md' });
  expect(cites.read.length === 0 && !cites.listed, 'learn: a Write that quotes a pill path is neither');
  expect(reads('Read', { file_path: '/p/.claude/pills/README.md' }).read.length === 0, 'learn: the format doc is not a lesson');

  const now = new Date();
  const ago = (d) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const today = now.toISOString().slice(0, 10);
  const loops = (role, ...days) => days.map((d) => ({ role, verdict: 'REJECTED', ts: ago(d) }));
  const lesson = (roles, date, extra = {}) => ({ rel: 'x', path: 'x', roles, date, last: extra.last ?? date, occurrences: 1, retired: false, body: '', ...extra });

  // graph diagnostics: one clear sentence for a missing section, and a repeated stage said
  const noEdges = validateGraph(parseGraph('## Stages\n\n- `qa` — runs tests\n\n## Edge\n\n- `qa` → `done` on `PASS`\n'), new Map([['qa', '`<TOKEN>` is one of `PASS` or `FAIL`']]));
  expect(noEdges.length === 1 && noEdges[0].includes('## Edges'), `graph: a missing Edges section is one problem, not a wall — got ${noEdges.length}`);
  const dup = validateGraph(parseGraph('## Stages\n\n- `qa` — a\n- `qa` — b\n\n## Edges\n\n- `qa` → `done` on `PASS`\n- `qa` → `human` on `FAIL`\n'), new Map([['qa', '`<TOKEN>` is one of `PASS` or `FAIL`']]));
  expect(dup.some((p) => p.includes('more than once')), 'graph: a stage listed twice is reported');

  // capture: an event, not a rate
  expect(overdue(loops('reviewer', 1, 2, 3), [], now).map((o) => o.role).join() === 'reviewer', 'learn: three loop-backs and no lesson is overdue');
  expect(overdue(loops('reviewer', 1, 2), [], now).length === 0, 'learn: two is not yet');
  expect(overdue(loops('reviewer', 20, 21, 22), [], now).length === 0, 'learn: loop-backs older than the window are history, not an event');
  expect(
    overdue(loops('reviewer', 1, 2, 3), [lesson(['reviewer'], ago(0).slice(0, 10))], now).length === 0,
    'learn: a lesson written after them settles it',
  );
  expect(
    overdue(loops('reviewer', 1, 2, 3), [lesson(['reviewer'], ago(10).slice(0, 10), { last: today })], now).length === 0,
    'learn: bumping an old lesson (last_seen today) settles it too — relearning is capture',
  );
  expect(
    overdue(loops('reviewer', 1, 2, 3), [lesson(['qa'], today)], now).length === 1,
    "learn: another role's lesson does not settle this one",
  );
  expect(
    overdue([...loops('reviewer', 1, 2), { role: 'reviewer', verdict: 'UNCLEAR', ts: ago(1) }], [], now).length === 0,
    'learn: an unreadable verdict is not counted as a loop-back',
  );

  // The same day: a date says which day, the file's time says when on it.
  const noon = `${today}T12:00:00.000Z`;
  const at = (h) => ({ role: 'reviewer', verdict: 'REJECTED', ts: `${today}T${h}:00:00.000Z` });
  const written = lesson(['reviewer'], today, { at: noon });
  expect(overdue([at('13'), at('14'), at('15')], [written], now).length === 1, 'learn: loop-backs after a lesson written the same day still count');
  expect(overdue([at('09'), at('10'), at('11')], [written], now).length === 0, 'learn: loop-backs before it, on the same day, are settled by it');
  // A lesson retires because its rule moved into the harness — it was still written down.
  expect(
    overdue(loops('reviewer', 1, 2, 3), [lesson(['reviewer'], today, { retired: true })], now).length === 0,
    'learn: a retired lesson still settles the loop-backs it captured',
  );

  // apply: only records that could answer are counted
  const use = applied(
    [
      { role: 'qa', lessons_read: 1, lessons_listed: false, ts: ago(1) },
      { role: 'qa', lessons_read: 0, lessons_listed: true, ts: ago(1) },
      { role: 'qa', lessons_read: 0, lessons_listed: false, ts: ago(1) },
      { role: 'qa', ts: ago(1) },
      { role: 'planner', lessons_read: 0, lessons_listed: false, ts: ago(1) },
    ],
    [lesson(['qa'], today)],
  );
  expect(
    use.measured === 3 && use.read === 1 && use.listed === 1,
    `learn: apply separates read, listed-only and neither, for taught roles only — got ${JSON.stringify(use)}`,
  );

  // verify: before and after, only with enough on both sides
  const pass = (d) => ({ role: 'qa', verdict: 'PASS', ts: ago(d) });
  const fail = (d) => ({ role: 'qa', verdict: 'FAIL', ts: ago(d) });
  const history = [...[30, 29, 28, 27, 26].map(fail), ...[5, 4, 3, 2, 1].map(pass)];
  const checked = verified(history, [lesson(['qa'], ago(10).slice(0, 10))]);
  expect(
    checked.length === 1 && checked[0].before.loops === 5 && checked[0].after.loops === 0 && 'control' in checked[0],
    'learn: verify compares the rate before a lesson with the rate after it, beside a control',
  );
  const late = overdue(loops('reviewer', 1, 2, 3).map((r, i) => ({ ...r, desc: `review ${i}`, session: 'abcdef123' })), [], now);
  expect(
    late[0]?.recent.length === 3 && late[0].recent[0].desc === 'review 0',
    'learn: a capture warning names the newest loop-backs, not just how many',
  );
  expect(verified(history.slice(0, 7), [lesson(['qa'], ago(10).slice(0, 10))]).length === 0, 'learn: too few on one side says nothing');

  // the command end to end: the detector fires, a lesson settles it, graduation writes a request
  const data = await scratch();
  const before = process.env.NINA_DATA;
  process.env.NINA_DATA = data;
  const newest = (await readdir(join(ROOT, 'releases'))).sort(byVersion).at(-1);
  const dir = await scratch();
  await mkdir(join(dir, '.nina'), { recursive: true });
  await writeFile(join(dir, '.nina', 'profile.json'), JSON.stringify({ core: newest, surfaces: [], vocabulary: {} }));
  await mkdir(join(data, 'snapshots'), { recursive: true });
  await writeFile(
    join(data, 'snapshots', `${slugFor(dir)}.jsonl`),
    `${loops('reviewer', 1, 2, 3).map((r) => JSON.stringify(r)).join('\n')}\n`,
  );
  const fired = run(['learn', '--check', '--project', dir]);
  expect(fired.status === 1 && fired.out.includes('reviewer: 3 loop-back'), `learn: --check should fire — got ${fired.status}\n${fired.out}`);
  // Inside an upgrade the same history is not the move's fault: a version that ships this detector
  // for the first time would otherwise roll itself back for what it made visible.
  process.env.NINA_UPGRADE = '1';
  expect(run(['learn', '--check', '--project', dir]).status === 0, 'learn: during an upgrade, owed lessons do not fail the move');
  delete process.env.NINA_UPGRADE;

  await mkdir(join(dir, '.claude', 'pills', 'reviewer'), { recursive: true });
  const pillPath = join(dir, '.claude', 'pills', 'reviewer', 'lesson.md');
  await writeFile(pillPath, `---\napplies_to: [reviewer]\nstatus: active\ndate: ${today}\noccurrences: 1\n---\n**Rule:** do the thing.\n`);
  const settled = run(['learn', '--check', '--project', dir]);
  expect(settled.status === 0, `learn: a lesson should settle the detector — got ${settled.status}\n${settled.out}`);

  // Through the file, not a hand-built object: the unit cases above passed with last_seen ignored
  // entirely, because they constructed the parsed lesson themselves and never read the field.
  const old = ago(10).slice(0, 10);
  await writeFile(pillPath, `---\napplies_to: [reviewer]\nstatus: active\ndate: ${old}\noccurrences: 1\n---\n**Rule:** do the thing.\n`);
  expect(run(['learn', '--check', '--project', dir]).status === 1, 'learn: a lesson older than the loop-backs does not settle them');
  await writeFile(pillPath, `---\napplies_to: [reviewer]\nstatus: active\ndate: ${old}\nlast_seen: ${today}\noccurrences: 2\n---\n**Rule:** do the thing.\n`);
  expect(run(['learn', '--check', '--project', dir]).status === 0, 'learn: bumping it — last_seen today — does');

  // Recurring three times is an event too, and the detector answers it itself: filing a request
  // decides nothing, so it used to wait on a command nobody was told to type.
  await writeFile(pillPath, `---\napplies_to: [reviewer]\nstatus: active\ndate: ${old}\nlast_seen: ${today}\noccurrences: 3\n---\n**Rule:** do the thing.\n`);
  const sentOff = run(['learn', '--check', '--project', dir]);
  const reqs = await readdir(join(dir, '.nina', 'requests')).catch(() => []);
  expect(
    sentOff.status === 1 && sentOff.out.includes('sent to the harness') && reqs.length === 1,
    `learn: a lesson at 3 occurrences is sent to the harness by the detector — got ${sentOff.status}, ${reqs.length} request(s)\n${sentOff.out}`,
  );
  expect(!sentOff.out.includes('write the pill'), 'learn: a lesson that only needs sending is not told to write itself');
  expect(run(['learn', '--check', '--project', dir]).status === 0, 'learn: once it is sent, the detector is quiet');
  expect(
    run(['learn', '--graduate', '.claude/pills/reviewer/lesson.md', '--project', dir]).status === 1,
    'learn: a second graduation of one lesson is refused, not written over the first',
  );
  const req = reqs.length ? await readFile(join(dir, '.nina', 'requests', reqs[0]), 'utf8') : '';
  expect(req.includes(`core: ${newest}`) && req.includes('target: core') && req.includes('do the thing'), 'learn: the request carries the pin, the layer and the lesson');
  expect(run(['requests']).out.includes('.claude/pills/reviewer/lesson.md'), "requests: the harness inbox should list the project's request");
  expect(run(['requests', '--check']).status === 1, 'requests: an open request is a signal on the harness side');

  // The harness answers it, a release carries the answer, and the upgrade that installs the release
  // closes it. Answering writes the working core, so it runs against a copy of the CLI whose core is
  // a scratch directory — never this repository's.
  const fake = await scratch();
  for (const part of ['bin', 'src', 'package.json']) await cp(join(ROOT, part), join(fake, part), { recursive: true });
  await mkdir(join(fake, 'core', 'tree', '.claude', 'agents'), { recursive: true });
  await writeFile(join(fake, 'core', 'tree', '.claude', 'agents', 'reviewer.md'), 'the rule\n');
  const inFake = (args) => {
    const r = spawnSync(process.execPath, [join(fake, 'bin', 'nina.mjs'), ...args, '--quiet'], { encoding: 'utf8', cwd: fake });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const id = (reqs[0] ?? '').replace(/\.md$/, '');
  expect(inFake(['requests', '--answer', id, '--in', 'core/tree/nope.md']).status === 1, 'requests: an answer names a layer file that exists');
  expect(inFake(['requests', '--answer', 'no-such-request', '--in', 'core/tree/.claude/agents/reviewer.md']).status === 1, 'requests: an answer names an open request');
  const answered = inFake(['requests', '--answer', id, '--in', 'core/tree/.claude/agents/reviewer.md']);
  const recorded = JSON.parse(await readFile(join(fake, 'core', 'answered.json'), 'utf8').catch(() => '{}'));
  expect(answered.status === 0 && recorded[id]?.in === 'core/tree/.claude/agents/reviewer.md', `requests: --answer records it in the working core — got ${answered.status}\n${answered.out}`);
  const unreleased = inFake(['requests', '--check']);
  expect(unreleased.status === 1 && unreleased.out.includes('waiting for a release'), `requests: an answer no release carries is still this repo's to finish\n${unreleased.out}`);
  await mkdir(join(fake, 'releases', '9.9.9'), { recursive: true });
  await cp(join(fake, 'core'), join(fake, 'releases', '9.9.9', 'core'), { recursive: true });
  expect(inFake(['requests', '--check']).status === 0, 'requests: once released, the answer waits on the project, not on the harness');
  expect(inFake(['requests']).out.includes('answered in 9.9.9'), 'requests: the inbox says which release carries the answer');

  const closedNow = await closeAnswered(dir, join(fake, 'releases', '9.9.9'), '9.9.9');
  const pillAfter = await readFile(pillPath, 'utf8');
  const reqAfter = reqs.length ? await readFile(join(dir, '.nina', 'requests', reqs[0]), 'utf8') : '';
  expect(
    closedNow.length === 1 && closedNow[0].where === '.claude/agents/reviewer.md' && /^status: retired$/m.test(pillAfter) &&
      /^status: closed$/m.test(reqAfter) && /^answered_in: 9\.9\.9$/m.test(reqAfter),
    `learn: the release's answer closes the request and retires the pill — got ${JSON.stringify(closedNow)}\n${reqAfter}`,
  );
  expect((await closeAnswered(dir, join(fake, 'releases', '9.9.9'), '9.9.9')).length === 0, 'learn: an answered request is closed once');
  expect(run(['requests', '--check']).status === 0, 'requests: a closed request is no longer waiting');
  expect(run(['learn', '--check', '--project', dir]).status === 0, 'learn: retiring the lesson does not reopen the loop-backs it captured');

  // A decline closes the request and leaves the pill: the lesson is still true in its project.
  const other = await scratch();
  await mkdir(join(other, '.nina', 'requests'), { recursive: true });
  await writeFile(join(other, '.nina', 'profile.json'), JSON.stringify({ core: newest, surfaces: [], vocabulary: {} }));
  await mkdir(join(other, '.claude', 'pills', 'qa'), { recursive: true });
  await writeFile(join(other, '.claude', 'pills', 'qa', 'local.md'), `---\napplies_to: [qa]\nstatus: active\ndate: ${old}\noccurrences: 3\n---\nlocal\n`);
  const request = (pill) => `---\nkind: harness-request\nstatus: open\ndate: ${old}\ncore: 0.1.0\ntarget: core\npill: ${pill}\n---\n`;
  await writeFile(join(other, '.nina', 'requests', 'r-local.md'), request('.claude/pills/qa/local.md'));
  await writeFile(join(other, '.nina', 'requests', 'r-manual.md'), request('.claude/pills/qa/local.md'));
  await writeFile(join(other, '.claude', 'pills', 'qa', 'money.md'), `---\napplies_to: [qa]\nstatus: active\ndate: ${old}\noccurrences: 3\n---\nmoney\n`);
  await writeFile(join(other, '.nina', 'requests', 'r-money.md'), request('.claude/pills/qa/money.md'));
  const layer = await scratch();
  await mkdir(join(layer, 'core'), { recursive: true });
  await writeFile(
    join(layer, 'core', 'answered.json'),
    JSON.stringify({ 'r-local': { declined: 'names\n  this project’s script' }, 'r-money': { in: 'surfaces/money/tree/CLAUDE.md' } }),
  );
  const answeredHere = await closeAnswered(other, layer, '9.9.9');
  const declined = answeredHere.find((a) => a.file === 'r-local.md');
  const localReq = await readFile(join(other, '.nina', 'requests', 'r-local.md'), 'utf8');
  expect(
    declined?.status === 'declined' && /^status: declined$/m.test(localReq) &&
      /^declined: names this project’s script$/m.test(localReq) &&
      /^status: active$/m.test(await readFile(join(other, '.claude', 'pills', 'qa', 'local.md'), 'utf8')),
    `learn: a decline closes the request on one line and leaves the pill active — got ${JSON.stringify(answeredHere)}\n${localReq}`,
  );
  // A rule that went into a surface this project does not declare never reaches it: retiring the
  // pill would drop the lesson with nothing in its place.
  const elsewhere = answeredHere.find((a) => a.file === 'r-money.md');
  expect(
    elsewhere?.status === 'closed' && elsewhere.needs === 'money' && elsewhere.pill === null &&
      /^status: active$/m.test(await readFile(join(other, '.claude', 'pills', 'qa', 'money.md'), 'utf8')),
    `learn: an answer in a layer this project lacks closes the request and keeps the pill — got ${JSON.stringify(elsewhere)}`,
  );

  // A request that cannot be written is a finding, not a crash — a detector that throws is reported
  // as one that could not run, every turn, and takes its other findings with it.
  const locked = await scratch();
  await mkdir(join(locked, '.claude', 'pills', 'qa'), { recursive: true });
  await mkdir(join(locked, '.nina'), { recursive: true });
  await writeFile(join(locked, '.nina', 'profile.json'), JSON.stringify({ core: newest, surfaces: [], vocabulary: {} }));
  await writeFile(join(locked, '.nina', 'requests'), 'a file where the directory should be\n');
  await writeFile(join(locked, '.claude', 'pills', 'qa', 'stuck.md'), `---\napplies_to: [qa]\nstatus: active\ndate: ${old}\noccurrences: 3\n---\nstuck\n`);
  const cannot = run(['learn', '--check', '--project', locked]);
  expect(
    cannot.status === 1 && cannot.out.includes('could not be written') && !cannot.out.includes('node:internal'),
    `learn: an unwritable request is reported, not thrown — got ${cannot.status}\n${cannot.out}`,
  );

  // Two projects can file the same id — a date and a pill path. One answer reaches both, and says so.
  const twins = [await scratch(), await scratch()];
  for (const twin of twins) {
    await mkdir(join(twin, '.nina', 'requests'), { recursive: true });
    await writeFile(join(twin, '.nina', 'requests', '2026-01-01-qa__twin.md'), request('.claude/pills/qa/twin.md'));
    await writeFile(join(data, 'snapshots', `${slugFor(twin)}.jsonl`), '');
  }
  const both = inFake(['requests', '--answer', '2026-01-01-qa__twin', '--in', 'core/tree/.claude/agents/reviewer.md']);
  expect(both.status === 0 && both.out.includes('2 projects filed this same id'), `requests: one id filed by two projects is answered once, out loud — got ${both.status}\n${both.out}`);

  // Closing by hand stays one command, and it retires the pill with it.
  const closed = run(['learn', '--close', 'r-manual', '--project', other]);
  const after = await readFile(join(other, '.claude', 'pills', 'qa', 'local.md'), 'utf8');
  expect(closed.status === 0 && /^status: retired$/m.test(after), `learn: --close should retire the pill — got ${closed.status}\n${after}`);

  if (before === undefined) delete process.env.NINA_DATA;
  else process.env.NINA_DATA = before;
}

// ─── snapshot: re-reading history never degrades it ─────────────────────────────────────
{
  // The measurement store is the only copy of history older than Claude Code's transcript
  // retention. An audit reproduced it losing a verdict and every field learned from a subagent's
  // own transcript when bytes were re-read after a cursor went back: the dispatch was re-created
  // blank, and the snapshot — which now writes whenever a record changes — wrote the blank over it.
  const dir = await scratch();
  const at = '2026-09-01T10:00:00.000Z';
  const done = '2026-09-01T10:05:00.000Z';
  await writeFile(
    join(dir, 'session.jsonl'),
    [
      JSON.stringify({ type: 'assistant', uuid: 'u1', timestamp: at, sessionId: 's1', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'reviewer', description: 'Review the diff' } }] } }),
      JSON.stringify({ type: 'user', uuid: 'u2', timestamp: done, message: { content: '<task-notification><tool-use-id>toolu_1</tool-use-id><status>completed</status><result>Looks fine overall but REJECTED on one point.</result></task-notification>' } }),
      '',
    ].join('\n'),
  );
  const first = await scanProject(dir, {});
  const rich = { ...first.records[0], verdict: 'APPROVED', verdict_source: 'handback', agent_read: true, lessons_read: 2, lessons_listed: false };

  // Cursor back to zero, prior records kept: the same bytes are read again.
  const again = (await scanProject(dir, { cursors: {}, records: [rich] })).records[0];
  expect(again.verdict === 'APPROVED' && again.verdict_source === 'handback', `snapshot: a re-read must not replace a better verdict — got ${again.verdict} (${again.verdict_source})`);
  expect(again.lessons_read === 2 && again.agent_read === true, 'snapshot: a re-read must keep what the subagent transcript taught the record');
  expect(again.resumes === 0, `snapshot: re-reading one notification is not a resume — got ${again.resumes}`);
}

// ─── detectors: a finding reaches the model, not only the person ───────────────────────
{
  // A Stop hook's systemMessage is shown to the person and never to the model, so every detector
  // reported to the one reader not about to act on it. --context speaks to the model instead.
  const dir = await scratch();
  await writeFile(join(dir, 'package.json'), '{"name":"d","scripts":{}}');
  await writeFile(join(dir, 'fail.mjs'), "console.log('the map is stale'); process.exit(1);\n");
  await writeFile(join(dir, 'pass.mjs'), 'process.exit(0);\n');
  const mode = (script, flag) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { runDetectors } from ${JSON.stringify(join(ROOT, 'src', 'detectors.mjs'))};` +
          `process.exit(runDetectors([{ name: 'map', script: '${script}', args: [] }], { root: ${JSON.stringify(dir)}, ${flag}: true }));`,
      ],
      { encoding: 'utf8' },
    );

  const told = mode('fail.mjs', 'context');
  let payload = null;
  try {
    payload = JSON.parse(told.stdout);
  } catch {
    // reported below
  }
  expect(told.status === 0, 'detectors: --context never fails the prompt it runs before');
  expect(
    payload?.hookSpecificOutput?.hookEventName === 'UserPromptSubmit' &&
      payload.hookSpecificOutput.additionalContext.includes('the map is stale'),
    `detectors: --context hands the finding to the model as UserPromptSubmit additionalContext — got ${told.stdout}`,
  );
  expect(mode('pass.mjs', 'context').stdout === '', 'detectors: --context says nothing when there is nothing to say');
  expect(JSON.parse(mode('fail.mjs', 'hook').stdout).systemMessage?.includes('the map is stale'), 'detectors: --hook is unchanged');
}

// ─── pills: a composed project to plant corrections in ──────────────────────────────────
/**
 * A scratch project with its harness composed, so `.claude/agents/` exists and the pill
 * validator has a role list to check against.
 *
 * @param {string} fixture - Which fixture to compose.
 * @returns {Promise<string>} The project directory.
 */
async function composed(fixture) {
  const dir = await scratch();
  await cp(join(ROOT, 'fixtures', fixture, '.nina'), join(dir, '.nina'), { recursive: true });
  run(['compose', '--project', dir]);
  // The control pill cites this file. Without it every pill below would be stale by
  // construction, which is how the staleness check announced itself the first time it ran.
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'thing.ts'), 'one\ntwo\nthree\nfour\nfive\n');
  return dir;
}

/**
 * Plants one pill.
 *
 * @param {string} dir - The project.
 * @param {string} rel - Path under `.claude/pills`.
 * @param {string} text - The pill.
 */
async function plant(dir, rel, text) {
  const path = join(dir, '.claude', 'pills', rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** A pill that meets the format in every respect — the control for every failure below. */
const WELL_FORMED = `---
id: reviewer-never-approve-on-a-local-run
applies_to: [reviewer]
severity: high
status: active
date: 2026-09-01
occurrences: 2
trigger: about to approve a diff on the strength of a run done outside CI
citations: [src/thing.ts:3]
---
**What went wrong:** approved on a green local run that CI then failed.
**Rule:** approve on CI, never on a local run.
**Why:** the local run reuses a warm cache CI does not have.
**How to apply:** quote the CI run id in the verdict.
source: the 2026-09-01 review
`;

// A well-formed pill must pass, or every failure below proves nothing.
{
  const dir = await composed('acme');
  await plant(dir, 'reviewer/never-approve-on-a-local-run.md', WELL_FORMED);
  const { status, out } = run(['pills', '--project', dir]);
  expect(status === 0, `pills: a well-formed pill should pass — got ${out.trim()}`);
  expect(!out.includes('✗'), `pills: a well-formed pill should raise nothing — got ${out.trim()}`);
}

// The two defects the real corpus had, and the two the format now forbids.
{
  const dir = await composed('acme');
  await plant(dir, 'reviewer/no-header.md', '# A lesson with no frontmatter\n\nsource: a run\n');
  await plant(dir, 'architect/two-roles-one-home.md', WELL_FORMED
    .replace('id: reviewer-never-approve-on-a-local-run', 'id: architect-two-roles-one-home')
    .replace('applies_to: [reviewer]', 'applies_to: [architect, implementer]'));
  await plant(dir, 'loose.md', WELL_FORMED.replace('id: reviewer-never-approve-on-a-local-run', 'id: -loose'));
  const { status, out } = run(['pills', '--project', dir]);
  expect(status === 1, 'pills: a malformed corpus should exit 1');
  expect(out.includes('no-header.md has no frontmatter'), 'pills: should name the pill with no frontmatter');
  expect(
    out.includes('two-roles-one-home.md declares 2 roles') && out.includes('implementer never read it'),
    `pills: should name the role a misfiled pill never reaches — got ${out.trim()}`,
  );
  expect(out.includes('loose.md sits at the top level'), 'pills: should report a pill no agent globs');
}

// `source` closes the body, where the format has always put it — a pill with one has evidence.
{
  const dir = await composed('acme');
  const noCitations = WELL_FORMED.replace('citations: [src/thing.ts:3]\n', '');
  await plant(dir, 'reviewer/never-approve-on-a-local-run.md', noCitations);
  const { status, out } = run(['pills', '--project', dir]);
  expect(status === 0, `pills: a body "source:" line is evidence — got ${out.trim()}`);
  expect(out === '', `pills: --quiet on a clean corpus should say nothing at all — got ${out.trim()}`);
  expect(
    run(['pills', '--project', dir], { loud: true }).out.includes('cite no code'),
    'pills: without --quiet it should note that staleness is uncheckable',
  );

  const dir2 = await composed('acme');
  await plant(dir2, 'reviewer/never-approve-on-a-local-run.md', noCitations.replace(/^source:.*$/m, ''));
  const bare = run(['pills', '--project', dir2]);
  expect(bare.status === 1, 'pills: a pill with neither citations nor source should fail');
  expect(bare.out.includes('carries no evidence'), 'pills: should say the pill carries no evidence');
}

// The filename may repeat the role, and often does.
{
  const dir = await composed('acme');
  await plant(dir, 'reviewer/reviewer-never-approve-on-a-local-run.md',
    WELL_FORMED.replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-reviewer-never-approve-on-a-local-run'));
  expect(run(['pills', '--project', dir]).status === 0, 'pills: an id repeating the role should be accepted');

  const dir2 = await composed('acme');
  await plant(dir2, 'reviewer/reviewer-never-approve-on-a-local-run.md', WELL_FORMED);
  expect(run(['pills', '--project', dir2]).status === 0, 'pills: an id not repeating the role should be accepted too');

  const dir3 = await composed('acme');
  await plant(dir3, 'reviewer/never-approve-on-a-local-run.md',
    WELL_FORMED.replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-some-other-pill'));
  expect(run(['pills', '--project', dir3]).status === 1, 'pills: an id naming another pill should fail');
}

// A role the project does not compose is a pill nobody will ever read.
{
  const dir = await composed('plain');
  await plant(dir, 'shared/needs-two-roles.md', WELL_FORMED
    .replace('id: reviewer-never-approve-on-a-local-run', 'id: shared-needs-two-roles')
    .replace('applies_to: [reviewer]', 'applies_to: [reviewer, dba]'));
  const { status, out } = run(['pills', '--project', dir]);
  expect(status === 1, 'pills: a pill for an uncomposed role should fail on a surfaceless project');
  expect(out.includes('applies_to "dba"'), `pills: should name the role the project lacks — got ${out.trim()}`);
}

// The enumerated fields, and a date that has not happened.
{
  const dir = await composed('acme');
  await plant(dir, 'reviewer/never-approve-on-a-local-run.md', WELL_FORMED
    .replace('severity: high', 'severity: critical')
    .replace('status: active', 'status: draft')
    .replace('occurrences: 2', 'occurrences: many')
    .replace('date: 2026-09-01', 'date: 2099-01-01')
    .replace('citations: [src/thing.ts:3]', 'citations: [src/commands/pills.mjs line 42]'));
  const { status, out } = run(['pills', '--project', dir]);
  expect(status === 1, 'pills: bad enums should fail');
  for (const said of ['severity "critical"', 'status "draft"', 'occurrences "many"', 'in the future', 'expected path or path:line']) {
    expect(out.includes(said), `pills: should report ${said} — got ${out.trim()}`);
  }
}

// An uncomposed project cannot be judged: the role list is what validation is against.
{
  const dir = await scratch();
  expect(run(['pills', '--project', dir]).status === 1, 'pills: should refuse a project with no composed agents');
}


// ─── pills: a citation is the one part that can be checked against the world ────────────
{
  const dir = await composed('acme');
  await plant(dir, 'reviewer/vanished.md', WELL_FORMED
    .replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-vanished')
    .replace('citations: [src/thing.ts:3]', 'citations: [src/deleted-long-ago.ts:3]'));
  await plant(dir, 'reviewer/past-the-end.md', WELL_FORMED
    .replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-past-the-end')
    .replace('citations: [src/thing.ts:3]', 'citations: [src/thing.ts:900]'));
  const { status, out } = run(['pills', '--project', dir]);
  expect(status === 1, 'pills: an unresolvable citation should fail');
  expect(
    out.includes('cites src/deleted-long-ago.ts:3, which no longer exists'),
    `pills: should name the citation that is gone — got ${out.trim()}`,
  );
  expect(
    out.includes('cites src/thing.ts:900, but src/thing.ts has only 5 line(s)'),
    `pills: should say how long the file actually is — got ${out.trim()}`,
  );
  expect(
    run(['pills', '--project', dir], { loud: true }).out.includes('0 of 2 citation(s) still resolve'),
    'pills: should count how many citations resolve',
  );
}

// A citation that resolves can still be wrong: the file moved on after the pill was written.
{
  const dir = await composed('acme');
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: '2026-03-01T10:00:00', GIT_AUTHOR_DATE: '2026-03-01T10:00:00' },
  });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('add', 'src/thing.ts');
  git('commit', '-qm', 'the cited file');

  await plant(dir, 'reviewer/written-before.md', WELL_FORMED
    .replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-written-before')
    .replace('date: 2026-09-01', 'date: 2026-01-15'));
  const before = run(['pills', '--project', dir], { loud: true });
  expect(before.status === 0, 'pills: a file changing after the pill is a note, not a failure');
  expect(
    before.out.includes('which changed on 2026-03-01 — after the pill was written on 2026-01-15'),
    `pills: should date both the change and the pill — got ${before.out.trim()}`,
  );

  await plant(dir, 'reviewer/written-before.md', WELL_FORMED
    .replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-written-before')
    .replace('date: 2026-09-01', 'date: 2026-06-01'));
  expect(
    !run(['pills', '--project', dir], { loud: true }).out.includes('Verify before trusting'),
    'pills: a pill written after the last change to its citation is not suspect',
  );
}


// ─── pills: a lesson learned three times is a rule nobody wrote down ────────────────────
{
  const dir = await composed('acme');
  const recurring = (id, roles, times) => WELL_FORMED
    .replace('id: reviewer-never-approve-on-a-local-run', `id: ${id}`)
    .replace('applies_to: [reviewer]', `applies_to: [${roles}]`)
    .replace('occurrences: 2', `occurrences: ${times}`);

  await plant(dir, 'reviewer/keeps-happening.md', recurring('reviewer-keeps-happening', 'reviewer', 4));
  await plant(dir, 'dba/also-happening.md', recurring('dba-also-happening', 'dba', 3));
  await plant(dir, 'reviewer/learned-twice.md', recurring('reviewer-learned-twice', 'reviewer', 2));
  await plant(dir, 'reviewer/already-graduated.md',
    recurring('reviewer-already-graduated', 'reviewer', 9).replace('status: active', 'status: retired'));

  const { status, out } = run(['pills', '--project', dir], { loud: true });
  expect(status === 0, `pills: a recurring pill is work to do, not a failure — got ${out.trim()}`);
  expect(
    out.includes('reviewer/keeps-happening.md has recurred 4 times') && out.includes('Its home is core'),
    `pills: a lesson about an ungated role belongs in the core — got ${out.trim()}`,
  );
  expect(
    out.includes('dba/also-happening.md has recurred 3 times') && out.includes('Its home is surfaces/db'),
    `pills: a lesson about a surface-gated role belongs in that surface — got ${out.trim()}`,
  );
  expect(out.includes('dba exists only where'), 'pills: one role takes a singular verb');
  expect(!out.includes('learned-twice'), 'pills: twice is not yet a rule');
  expect(!out.includes('already-graduated'), 'pills: a retired pill is history, not a candidate');
}


// ─── stats: the loop-back a pill was supposed to come from ──────────────────────────────

// A temp directory is named `nina-cli-XXXX`, so its encoded form cannot be split on dashes
// without asking the filesystem — which is the case the resolver exists for.
{
  const dir = await scratch();
  expect(
    decodeProjectDir(dir.replace(/\//g, '-')) === dir,
    `stats: should resolve an encoded project whose own name contains dashes — got ${decodeProjectDir(dir.replace(/\//g, '-'))}`,
  );
  expect(decodeProjectDir('-no-such-place-anywhere') === null, 'stats: should return null for a path that is gone');
}

/**
 * Writes a snapshot stream for one project.
 *
 * @param {string} snapshots - Where the stream lands.
 * @param {string} project - The encoded project name.
 * @param {{role: string, verdict: string, ts: string, source?: string, issues?: number|null}[]} rows - The
 *   dispatches; `source` is the verdict's provenance, which decides whether it was declared or inferred,
 *   and `issues` how many issues a loop-back named, left out for a record from before the field.
 */
async function history(snapshots, project, rows) {
  await mkdir(snapshots, { recursive: true });
  const lines = rows.map((r) =>
    JSON.stringify({
      project,
      dispatch_id: `toolu_${Math.random().toString(36).slice(2)}`,
      ts: `${r.ts}T10:00:00.000Z`,
      role: r.role,
      verdict: r.verdict,
      verdict_source: r.source ?? 'declared',
      duration_s: 60,
      agent_id: null,
      skills: [],
      ...(r.issues === undefined ? {} : { issues: r.issues }),
    }),
  );
  await writeFile(join(snapshots, `${project}.jsonl`), `${lines.join('\n')}\n`);
}

/** Twelve reviewer runs, three of which sent the work back. */
const TWELVE_RUNS = Array.from({ length: 12 }, (_, i) => ({
  role: 'reviewer',
  verdict: i < 3 ? 'REJECTED' : 'APPROVED',
  ts: `2026-01-${String(i + 1).padStart(2, '0')}`,
}));

/**
 * A pill with a chosen date and status.
 *
 * @param {string|null} date - The `date` field, or `null` to omit it.
 * @param {string} status - The `status` field.
 * @returns {string}
 */
const dated = (date, status = 'active') =>
  WELL_FORMED.replace('date: 2026-09-01\n', date ? `date: ${date}\n` : '').replace('status: active', `status: ${status}`);

// Loop-backs and the pills they produced, on one screen.
{
  const dir = await composed('acme');
  const snapshots = join(await scratch(), 'snaps');
  await history(snapshots, dir.replace(/\//g, '-'), TWELVE_RUNS);
  await plant(dir, 'reviewer/in-window.md', dated('2026-01-05').replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-in-window'));
  await plant(dir, 'reviewer/graduated.md', dated('2026-01-06', 'retired').replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-graduated'));
  await plant(dir, 'reviewer/long-ago.md', dated('2025-06-01').replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-long-ago'));
  await plant(dir, 'reviewer/no-date.md', dated(null).replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-no-date'));

  const { out } = run(['stats', '--snapshots', snapshots]);
  expect(out.includes('learning'), `stats: should report a learning block — got ${out.trim()}`);
  expect(
    out.includes('3 loop-back(s) in the window → 2 pill(s) written'),
    `stats: 3 loop-backs and 2 pills dated inside the window — got ${out.trim()}`,
  );
  expect(out.includes('1 pill(s) carry no date'), 'stats: an undated pill should be reported, not silently dropped');
  expect(out.includes('1 of 4 pill(s) retired'), `stats: should count the graduated pill — got ${out.trim()}`);
  expect(!out.includes('no correction has ever graduated'), 'stats: should not claim nothing graduated when one did');
  expect(!out.includes('named their issues'), 'stats: records from before the ISSUES line are not counted as naming none');
}

// Whether loop-backs name their issues: only records that learned the field are asked.
{
  const dir = await composed('acme');
  const snapshots = join(await scratch(), 'snaps');
  await history(snapshots, dir.replace(/\//g, '-'), [
    ...TWELVE_RUNS,
    { role: 'reviewer', verdict: 'REJECTED', ts: '2026-01-20', issues: 2 },
    { role: 'qa', verdict: 'FAIL', ts: '2026-01-21', issues: 0 },
    { role: 'qa', verdict: 'PASS', ts: '2026-01-22', issues: null },
  ]);
  const { out } = run(['stats', '--snapshots', snapshots]);
  expect(out.includes('1 of 2 declared loop-back(s) (50%) named their issues'), `stats: counts the loop-backs that named their issues — got ${out.trim()}`);
}

// Nothing learned at all is the state worth naming, not a zero in a table.
{
  const dir = await composed('acme');
  const snapshots = join(await scratch(), 'snaps');
  await history(snapshots, dir.replace(/\//g, '-'), TWELVE_RUNS);
  const { out } = run(['stats', '--snapshots', snapshots]);
  expect(
    out.includes('3 loop-back(s) and not one pill'),
    `stats: should name an empty corpus outright — got ${out.trim()}`,
  );
}

// Every pill retired is the claim; every pill active is the one the real corpus makes.
{
  const dir = await composed('acme');
  const snapshots = join(await scratch(), 'snaps');
  await history(snapshots, dir.replace(/\//g, '-'), TWELVE_RUNS);
  await plant(dir, 'reviewer/still-active.md', dated('2026-01-05').replace('id: reviewer-never-approve-on-a-local-run', 'id: reviewer-still-active'));
  const { out } = run(['stats', '--snapshots', snapshots]);
  expect(
    out.includes('0 of 1 pill(s) retired — no correction has ever graduated into a rule'),
    `stats: should say graduation never fired — got ${out.trim()}`,
  );
}

// A project whose directory is gone is named, so its missing pills are not read as zero.
{
  const snapshots = join(await scratch(), 'snaps');
  await history(snapshots, '-gone-from-disk-entirely', TWELVE_RUNS);
  const { out } = run(['stats', '--snapshots', snapshots]);
  expect(
    out.includes('could not be located on disk'),
    `stats: an unresolvable project should be named — got ${out.trim()}`,
  );
}


// A gate is judged by its loop-back rate; a producer is not judged by it at all.
{
  const dir = await composed('acme');
  const snapshots = join(await scratch(), 'snaps');
  const day = (i) => `2026-02-${String((i % 28) + 1).padStart(2, '0')}`;
  const many = (role, rejects, total, source) =>
    Array.from({ length: total }, (_, i) => ({ role, verdict: i < rejects ? 'REJECTED' : 'APPROVED', ts: day(i), source }));
  await history(snapshots, dir.replace(/\//g, '-'), [
    ...many('dba', 1, 30, 'scan'), // a gate that almost never stops anything, and never said so itself
    ...many('reviewer', 9, 30), // a gate that does
    ...many('architect', 0, 30), // a producer: zero by nature, not by failure
    ...many('secops', 0, 5), // a gate, but too few verdicts to read a rate from
    // Runs that declared nothing readable: the rate cannot see them, so the report must say so.
    ...Array.from({ length: 10 }, (_, i) => ({ role: 'dba', verdict: 'UNCLEAR', ts: day(i), source: 'none' })),
  ]);

  const { out } = run(['stats', '--snapshots', snapshots]);
  expect(
    out.includes('dba: 1 loop-back(s) in 30 readable verdict(s) (3%)'),
    `stats: should flag the gate that stops nothing — got ${out.trim()}`,
  );
  // reviewer 9/30 and secops 0/5 together: the baseline aggregates verdicts, not rates.
  expect(out.includes('against 26% across the other gates'), 'stats: should compare against the gates that do stop things');
  expect(
    !out.includes('architect:') || !out.includes('gates anything'),
    'stats: a producer with zero loop-backs is not a failing gate',
  );
  expect(!/\barchitect: .*gates anything/.test(out), 'stats: should not ask whether the architect gates anything');
  expect(!/\bsecops: .*gates anything/.test(out), 'stats: five verdicts is not a rate');
  expect(!/\breviewer: .*gates anything/.test(out), 'stats: should not flag a gate that is working');
  expect(
    out.includes('10 further run(s) produced no readable verdict at all'),
    `stats: should qualify the rate with the runs it cannot see — got ${out.trim()}`,
  );
  expect(
    out.includes('Only 0 of the 30 were declared by the stage'),
    `stats: should separate declared verdicts from inferred ones — got ${out.trim()}`,
  );
}


// ─── packaged install: the two things that only exist in a checkout ─────────────────────
{
  // An installed package ships `releases/` and no working tree, so a `dev` pin — which means
  // "track the layers as they are being edited" — has nothing to track.
  const installed = await scratch();
  await mkdir(join(installed, 'releases', '0.0.1'), { recursive: true });
  expect(
    /pins core "dev"/.test(layerRootFor(installed, 'dev').error ?? ''),
    'packaging: a dev pin against an installed package should say so, not compose an empty tree',
  );
  expect(layerRootFor(ROOT, 'dev').dir === ROOT, 'packaging: a dev pin in the repo still tracks the working tree');
  expect(
    layerRootFor(installed, '0.0.1').dir === join(installed, 'releases', '0.0.1'),
    'packaging: a pinned release resolves out of the package',
  );

  // Cutting a release freezes the working tree, so it is a repo operation either way.
  const log = console.error;
  let said = '';
  console.error = (m) => { said += m; };
  const code = await release(['9.9.9'], { root: installed });
  console.error = log;
  expect(code === 1 && /no working core to freeze/.test(said), `packaging: release from a package should refuse — got ${code} ${said}`);
}

// The measured history is the user's and spans every project, so it is not kept in the install.
{
  const home = await scratch();
  const before = process.env.NINA_DATA;
  process.env.NINA_DATA = home;
  expect(snapshotsDir() === join(home, 'snapshots'), 'packaging: NINA_DATA should decide where history lands');
  delete process.env.NINA_DATA;
  expect(
    !snapshotsDir().includes('node_modules') && snapshotsDir().endsWith(join('.nina', 'snapshots')),
    `packaging: history defaults under the user's home — got ${snapshotsDir()}`,
  );
  if (before !== undefined) process.env.NINA_DATA = before;
}


// ─── releases are ordered by number, not as text ─────────────────────────────────────────
{
  // `init` pins the newest release when none is named. Sorted as text, `0.10.0` lands before
  // `0.9.0` because `'1' < '9'`, so the first two-digit minor would silently pin the release
  // before it — and nothing downstream reports composing an older core than asked for.
  const sorted = ['0.9.0', '0.10.0', '0.2.0', '1.0.0'].sort(byVersion);
  expect(
    sorted.at(-1) === '1.0.0' && sorted[1] === '0.9.0' && sorted[2] === '0.10.0',
    `releases: should order by number — got ${sorted.join(', ')}`,
  );
}

// ─── init: the detection summary, and what it offers to consider ────────────────────────
{
  // Detection ran on every init, but the summary that prints it only runs on the scripted
  // path — so `detected` being a list of names while the summary read `.surface` off each
  // one crashed any non-interactive init of a repository that revealed a surface at all.
  const dir = await scratch();
  await writeFile(join(dir, 'foundry.toml'), '[profile.default]\nsrc = "src"\n');
  const { status, out } = run(['init', '--project', dir, '--core', 'dev', '--no-ask'], { loud: true });

  expect(status === 0, `init: a detected surface must not crash the summary — exit ${status}\n${out}`);
  expect(
    /detected\s+blockchain\s+a Foundry or Hardhat config/.test(out),
    `init: should detect blockchain and say why — got ${out}`,
  );

  // The question map keeps entries for surfaces that were renamed or dropped, so an old
  // pinned release still asks its own questions. Offering one of those here would name a
  // surface that `--surfaces` then refuses.
  expect(!/consider\s+external-api/.test(out), 'init: must not offer a surface this core does not have');
  expect(/consider\s+money/.test(out), `init: should still offer the undetectable surfaces — got ${out}`);
}

// ─── what a surface costs must not include what another surface gates ───────────────────
{
  // A surface carries fragments for roles another surface creates — `money` has text for
  // `dba` and for the solidity pair. None of it composes unless that other surface is also
  // declared, so listing it against `money` alone quotes a cost that would not be paid.
  const dir = await scratch();
  run(['init', '--project', dir, '--surfaces', 'money', '--core', 'dev']);
  const todo = await readFile(join(dir, '.nina', 'TODO.md'), 'utf8');
  // Found by the surface it describes, not by its count: the count moves whenever a fragment is added.
  const lines = todo.split('\n');
  const at = lines.findIndex((l) => l.includes('**money**'));
  expect(at >= 0, 'init: the TODO lists the money surface');
  const line = at >= 0 ? (lines[at + 1] ?? '') : '';

  for (const gated of ['dba', 'integration-tester', 'solidity-dev', 'solidity-auditor']) {
    expect(!line.includes(gated), `init: money's cost must not claim to change ${gated} — got ${line.trim()}`);
  }
  expect(/changes: .*reviewer/.test(line), `init: money should still list the agents it does change — got ${line.trim()}`);
}

// ─── the notice goes below frontmatter, whatever the file looks like ─────────────────────
{
  // A `\r\n` file missed the frontmatter match and took the notice ABOVE the block, which is
  // the silent break the notice exists to prevent: Claude Code stops dispatching a spec whose
  // `---` is not at byte 0, and says nothing. Nothing in the repo has CRLF today, so the
  // fixtures cannot reach this — it is asserted against the function.
  const crlf = stamp('---\r\nname: reviewer\r\ntools: Read\r\n---\r\nBody.\r\n', '.claude/agents/reviewer.md', ['project.1 role-intro']);
  expect(crlf.startsWith('---\r\n'), `stamp: CRLF frontmatter must stay at byte 0 — got ${JSON.stringify(crlf.slice(0, 24))}`);
  expect(crlf.includes('<!-- nina:generated'), 'stamp: CRLF file must still carry the notice');

  // And `---` on line 1 is a horizontal rule as often as it is frontmatter. Believing it hides
  // the notice after the SECOND `---`, halfway down a document nobody reads that far into.
  const rule = stamp('---\n# Patterns\n\nSection one.\n\n---\n\nSection two.\n', '.claude/patterns.md', []);
  expect(
    rule.startsWith('<!-- nina:generated'),
    `stamp: a leading horizontal rule is not frontmatter — got ${JSON.stringify(rule.slice(0, 24))}`,
  );

  // A script has the same hazard one file type over: `#!` one character in is a comment, and
  // the file stops being executable by the hook that runs it every turn. The notice comments
  // as code there, because an HTML comment in a module is a SyntaxError.
  const script = stamp('#!/usr/bin/env node\nconst x = 1;\n', 'scripts/harness-check.mjs', ['project.1 detectors']);
  expect(script.startsWith('#!/usr/bin/env node\n'), `stamp: a shebang must stay at byte 0 — got ${JSON.stringify(script.slice(0, 24))}`);
  expect(script.includes('\n// nina:generated'), 'stamp: a script takes a line comment, not an HTML one');
  expect(!script.includes('<!--'), 'stamp: an HTML comment in a module is a SyntaxError');

  // Ordinary frontmatter still works, or the guard above would have cost the thing it protects.
  const yaml = stamp('---\nname: dba\n---\n\nBody.\n', '.claude/agents/dba.md', ['project.1 role-intro']);
  expect(yaml.startsWith('---\nname: dba\n---\n<!-- nina:generated'), 'stamp: LF frontmatter must still be detected');
}

// ─── a dependency's files are not this project's surfaces ────────────────────────────────
{
  // `init` walks the whole project to see which surfaces its files reveal, and with `--no-ask`
  // what it finds is written straight into the profile. A dependency ships the same filenames:
  // one `foundry.toml` in an example tree used to declare the blockchain surface.
  const dir = await scratch();
  await mkdir(join(dir, 'node_modules', '@oz', 'ex'), { recursive: true });
  await mkdir(join(dir, '.git', 'objects'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'node_modules', '@oz', 'ex', 'foundry.toml'), '[profile.default]\n');
  await writeFile(join(dir, 'node_modules', '@oz', 'ex', 'schema.prisma'), 'model X {}\n');
  await writeFile(join(dir, '.git', 'objects', 'wrangler.toml'), 'name = "x"\n');
  await writeFile(join(dir, 'src', 'index.ts'), 'export const x = 1;\n');

  const seen = await walk(dir);
  expect(
    JSON.stringify(seen) === JSON.stringify([join('src', 'index.ts')]),
    `walk: must not descend into node_modules or .git — saw ${seen.join(', ')}`,
  );

  const { out } = run(['init', '--project', dir, '--core', 'dev', '--no-ask'], { loud: true });
  expect(
    /detected no surface from the files present/.test(out),
    `init: a dependency's config must not declare a surface — got ${out}`,
  );
}

// ─── the release order is total, so a stray name cannot become "newest" ──────────────────
{
  // `NaN` from a comparator is undefined behaviour for `sort`, and in practice floats the
  // malformed name to the end — where `at(-1)`, which is how `init` picks the newest release,
  // would take it and then try to read `releases/README.md/surfaces`.
  for (const [a, b] of [['0.1.0-rc1', '0.1.0'], ['README.md', '0.1.0'], ['', '0.1.0']]) {
    expect(Number.isFinite(byVersion(a, b)), `byVersion(${a}, ${b}) must be a number, got ${byVersion(a, b)}`);
    expect(Number.isFinite(byVersion(b, a)), `byVersion(${b}, ${a}) must be a number, got ${byVersion(b, a)}`);
  }
  expect(byVersion('1.0', '1.0.0') === 0, 'byVersion: a missing segment reads as zero');
}

// ─── a composed script nothing runs is a file being correct and doing nothing ────────────
{
  // Composing a script is not wiring it: a new project gets the file and nothing that reaches it, and
  // nothing is missing, so nothing reports it. The scripts hooks run are asked for hook by hook, and by
  // the npm script NAME the specs tell a stage to run — `pnpm harness:check` — so any other name for
  // it does not count.
  const releases = (await readdir(join(ROOT, 'releases'))).sort(byVersion);
  const newest = releases.at(-1);

  const make = async (scripts) => {
    const dir = await scratch();
    await mkdir(join(dir, '.nina'), { recursive: true });
    await writeFile(join(dir, '.nina', 'profile.json'), JSON.stringify({ core: newest, surfaces: [], vocabulary: {} }, null, 2));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts }, null, 2));
    return dir;
  };

  const bare = await make({});
  const loose = run(['check', '--project', bare], { loud: true });
  const gated = (await shippedScripts(layerRootFor(ROOT, newest).dir, [])).has(GATE);
  expect(
    loose.out.includes('package.json has no "harness:check" script') &&
      loose.out.includes('no UserPromptSubmit hook running `scripts/harness-check.mjs --context`') &&
      (!gated || loose.out.includes('no PreToolUse hook for Agent|Task|SendMessage running `scripts/loop-gate.mjs`')),
    `check: an unwired harness is reported, script by name and hook by hook — got ${loose.out}`,
  );
  const renamed = await make({ 'whatever-i-call-it': 'node scripts/harness-check.mjs' });
  expect(
    run(['check', '--project', renamed], { loud: true }).out.includes('package.json has no "harness:check" script'),
    'check: the specs run `pnpm harness:check`, so another name for it is not wiring',
  );

  // Any other composed script is matched on its path, so a project may call it whatever it likes.
  const layer = await scratch();
  await mkdir(join(layer, 'core', 'tree', 'scripts'), { recursive: true });
  await writeFile(join(layer, 'core', 'tree', 'scripts', 'code-map.mjs'), '');
  await writeFile(join(layer, 'core', 'tree', 'scripts', 'loop-gate.mjs'), '');
  const owner = await make({});
  expect(
    (await unwiredScripts(layer, [], owner)).join() === 'scripts/code-map.mjs',
    'check: a composed script no npm script runs is named — and one a hook runs is left to the hook check',
  );
  const byPath = await make({ 'whatever-i-call-it': 'node scripts/code-map.mjs' });
  expect((await unwiredScripts(layer, [], byPath)).length === 0, 'check: matched on the path, not on a script name');
}

// ─── upgrade runs the sequence, and puts it back when a step fails ───────────────────────
{
  // Moving a project forward was six commands in a fixed order, and getting the order wrong
  // overwrote the project's own file. A procedure nobody can hold in their head is not a
  // procedure, so `--apply` runs it — and a step that fails has to leave nothing behind.
  const releases = (await readdir(join(ROOT, 'releases'))).sort(byVersion);
  const [from, to] = [releases.at(-2), releases.at(-1)];

  /**
   * A project pinned to `from`, whose own detector passes only while that pin holds — wired for `to`
   * first, as a real project is: a move whose new scripts have no hooks is refused outright.
   */
  const project = async (detector) => {
    const dir = await scratch();
    await mkdir(join(dir, '.nina'), { recursive: true });
    await writeFile(join(dir, '.nina', 'profile.json'), JSON.stringify({ core: from, surfaces: [], vocabulary: {} }, null, 2));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: { 'harness:check': detector } }, null, 2));
    await mkdir(join(dir, 'node_modules', '@xhulz'), { recursive: true });
    await symlink(ROOT, join(dir, 'node_modules', '@xhulz', 'nina'));
    run(['wire', '--project', dir, '--to', to, '--apply']);
    return dir;
  };

  const good = await project('echo "harness: current (1 detector clean)"');
  const applied = run(['upgrade', '--project', good, '--to', to, '--apply'], { loud: true });
  expect(applied.status === 0, `upgrade: the chain should succeed — got ${applied.status}\n${applied.out}`);
  expect(/✓\s+composing the harness files/.test(applied.out), `upgrade: should report composing — got ${applied.out}`);
  expect(/✓\s+running the project's own detectors/.test(applied.out), `upgrade: should run the project's detectors — got ${applied.out}`);
  expect(/applied and verified/.test(applied.out), `upgrade: should say it verified — got ${applied.out}`);
  expect(
    JSON.parse(await readFile(join(good, '.nina', 'profile.json'), 'utf8')).core === to,
    'upgrade: a verified chain leaves the new pin in place',
  );

  // The same move, against a project whose detector passes on the old pin and fails on the new.
  const bad = await project(`grep -q "${from}" .nina/profile.json && echo "harness: current" || { echo "harness: the new layers broke me"; exit 1; }`);
  const rolled = run(['upgrade', '--project', bad, '--to', to, '--apply'], { loud: true });
  expect(rolled.status === 1, `upgrade: a broken chain must exit non-zero — got ${rolled.status}`);
  expect(/rolling back to /.test(rolled.out), `upgrade: should say it is rolling back — got ${rolled.out}`);
  // Asserted on the log BLOCK, not on the sentence: the same words reach the one-line detail
  // too, so matching them alone passes with the log suppressed entirely.
  expect(/what it said:/.test(rolled.out), `upgrade: should print the failing step's log — got ${rolled.out}`);
  expect(/the new layers broke me/.test(rolled.out), `upgrade: should show what the step said — got ${rolled.out}`);
  expect(
    JSON.parse(await readFile(join(bad, '.nina', 'profile.json'), 'utf8')).core === from,
    'upgrade: a rolled-back chain restores the pin it started from',
  );

  // A check this project was already failing is not the upgrade's doing, and blaming the move
  // for it would roll back a move that was fine.
  expect(
    /still failing, as it was before the upgrade/.test(applied.out),
    `upgrade: a pre-existing failure must be reported, not rolled back for — got ${applied.out}`,
  );
}

// ─── release: the package version is written rather than remembered ─────────────────────
{
  // The package ships `releases/`, so its version and the newest release describe the same
  // thing. Bumping by hand let them drift two cuts apart, with the banner announcing the
  // stale number the whole time — so the cut writes it.
  const repo = await scratch();
  await mkdir(join(repo, 'core', 'tree'), { recursive: true });
  await mkdir(join(repo, 'surfaces', 'db', 'tree'), { recursive: true });
  await writeFile(join(repo, 'core', 'tree', 'CLAUDE.md'), '# core\n');
  const pkg = '{\n  "name": "@xhulz/nina",\n  "version": "1.0.0",\n  "engines": { "node": ">=20" }\n}\n';
  await writeFile(join(repo, 'package.json'), pkg);

  const log = console.log;
  let said = '';
  console.log = (m) => { said += `${m}\n`; };
  const code = await release(['1.2.3'], { root: repo });
  console.log = log;

  const after = await readFile(join(repo, 'package.json'), 'utf8');
  expect(code === 0, `release: should cut the release — got ${code}`);
  expect(JSON.parse(after).version === '1.2.3', `release: package.json should carry it — got ${JSON.parse(after).version}`);
  expect(/package\.json 1\.0\.0 → 1\.2\.3/.test(said), `release: the bump should be reported — got ${said.trim()}`);
  expect(
    after === pkg.replace('"version": "1.0.0"', '"version": "1.2.3"'),
    'release: only the version line may change — re-serializing the parsed object rewrites the file',
  );

  // No version field to find. Saying so is the whole point: a silent no-op here is exactly
  // how the number went stale in the first place.
  const bare = await scratch();
  await mkdir(join(bare, 'core'), { recursive: true });
  await mkdir(join(bare, 'surfaces'), { recursive: true });
  await writeFile(join(bare, 'package.json'), '{\n  "name": "x"\n}\n');
  said = '';
  console.log = (m) => { said += `${m}\n`; };
  await release(['2.0.0'], { root: bare });
  console.log = log;
  expect(/package\.json not updated/.test(said), `release: a missing version field must be reported — got ${said.trim()}`);
}


// ─── the loop gate: what counts as a round ───────────────────────────────────────────────
{
  // The rules were measured before they were written, and reviewed twice after. Replayed over six weeks
  // of one project, a count of "dispatches to the stage an edge points at, after a loop-back" reached the
  // cap eight times and was wrong seven. Each case here is one of the ways a count went wrong, or the
  // one way it was right.
  const text = [
    '## Stages',
    '',
    '- `reviewer` — r',
    '- `implementer` — i',
    '- `architect` — a',
    '- `qa` — q',
    '- `secops` — s',
    '- `dba` — d',
    '',
    '## Edges',
    '',
    '- `implementer` → `reviewer` on `DIFF-READY`',
    '- `dba` → `reviewer` on `APPROVED`',
    '- `dba` → `implementer` on `REJECTED` — a query is wrong · max 2',
    '- `reviewer` → `qa` on `APPROVED`',
    '- `reviewer` → `implementer` on `REJECTED` — a bug · max 2',
    '- `reviewer` → `architect` on `REJECTED` — a design flaw · max 2',
    '- `qa` → `done` on `PASS`',
    '- `qa` → `implementer` on `FAIL` — a test fails · max 2',
    '- `secops` → `done` on `SECURE`',
    '- `secops` → `implementer` on `BLOCKED` — a bug · max 2',
    '- `secops` → `architect` on `BLOCKED` — a design flaw · max 2',
    '- `architect` → `implementer` on `SPEC-READY`',
    '',
  ].join('\n');
  const loops = loopEdges(parseGraph(text));
  const forward = forwardEdges(parseGraph(text));
  let seq = 0;
  // Every report comes from an agent that was launched first, as in a real session.
  const report = (role, verdict, extra = {}) => {
    const agent = `${role}-${(seq += 1)}`;
    return [{ k: 'dispatch', role, agent }, { k: 'verdict', role, verdict, agent, declared: true, ...extra }];
  };
  const together = (...reports) => [...reports.map((r) => r[0]), ...reports.map((r) => r[1])];
  const fix = (role = 'implementer') => ({ k: 'dispatch', role, agent: `fix-${(seq += 1)}` });
  const spoke = { k: 'reset', why: 'prompt' };
  const next = (entries, role = 'implementer') => roundsFor(entries.flat(), role, loops, forward)[0]?.round ?? 0;

  const stuck = [report('reviewer', 'REJECTED'), fix(), report('reviewer', 'REJECTED'), fix(), report('reviewer', 'REJECTED')];
  expect(next(stuck.slice(0, 3)) === 2, 'gate: a second rejection acted on is round 2');
  expect(next(stuck) === 3, 'gate: and a third is round 3 — past a cap of 2');
  expect(next([...stuck.slice(0, 4), spoke, report('reviewer', 'REJECTED')]) === 1, 'gate: the owner speaking starts the count over');
  expect(next([report('reviewer', 'REJECTED'), fix(), fix(), report('reviewer', 'REJECTED')]) === 2, 'gate: two dispatches acting on the same verdicts are one round');
  expect(
    next([report('reviewer', 'REJECTED'), fix(), report('reviewer', 'APPROVED'), fix(), report('reviewer', 'REJECTED')]) === 1,
    'gate: a review that passes closes the loop — the next rejection starts at round 1',
  );
  expect(
    next([report('reviewer', 'REJECTED'), fix(), report('reviewer', 'APPROVED'), report('reviewer', 'REJECTED'), fix(), report('reviewer', 'REJECTED')]) === 2,
    'gate: and closes it even when the next rejection arrives before any fixer does',
  );
  // A fan-out: two reviewers launched together, one keeps rejecting, the other keeps approving.
  const fanned = () => together(report('reviewer', 'REJECTED'), report('reviewer', 'APPROVED'));
  expect(next([fanned(), fix(), fanned(), fix(), fanned()]) === 3, "gate: a sibling's approval releases nothing another reviewer rejected");
  // Reviewers of different dimensions, one after the other: security was launched after correctness
  // rejected, but no fix had gone out, so its approval says nothing about the rejection.
  const dimensions = () => [...report('reviewer', 'REJECTED'), ...report('reviewer', 'APPROVED')];
  expect(next([dimensions(), fix(), dimensions(), fix(), dimensions()]) === 3, 'gate: a review launched after a rejection releases it only if a fix went out between');
  // A background fan-out: the fixer goes out on one reviewer's rejection, the other approves late.
  const [ra, rb] = [report('reviewer', 'REJECTED'), report('reviewer', 'APPROVED')];
  expect(
    next([ra[0], rb[0], ra[1], fix(), rb[1], report('reviewer', 'REJECTED')]) === 2,
    'gate: an approval from a review that began before the fix does not close the loop',
  );
  // And the mirror: a sibling's rejection that lands after the fix went out belongs to the round it came from.
  const [sa, sb] = [report('reviewer', 'REJECTED'), report('reviewer', 'REJECTED')];
  expect(
    next([sa[0], sb[0], sa[1], fix(), sb[1], fix(), report('reviewer', 'REJECTED')]) === 2,
    "gate: a late sibling's rejection is part of the round it was running in, not a new one",
  );
  // A rejection the orchestrator settled itself stops counting once the stage after the reviewer passes.
  expect(next([report('reviewer', 'REJECTED'), report('qa', 'PASS')]) === 0, 'gate: qa passing closes the reviewer loop it came through');
  // But a stage sent out beside the gate — the reviewer and the dba go together — closes nothing by passing.
  const beside = () => together(report('dba', 'REJECTED'), report('reviewer', 'APPROVED'));
  const besideFirst = () => together(report('reviewer', 'APPROVED'), report('dba', 'REJECTED'));
  expect(next([beside(), fix(), beside(), fix(), beside()]) === 3, "gate: a reviewer approving beside the dba does not release the dba's rejection");
  expect(next([besideFirst(), fix(), besideFirst(), fix(), besideFirst()]) === 3, 'gate: whichever of the two reports first');
  const guessed = { declared: false };
  expect(
    next([report('reviewer', 'REJECTED', guessed), fix(), report('reviewer', 'REJECTED', guessed), fix(), report('reviewer', 'REJECTED', guessed)]) === 0,
    'gate: a verdict guessed from prose counts for nothing',
  );
  const [launched, once] = report('reviewer', 'REJECTED');
  expect(next([launched, once, { ...once }, fix(), report('reviewer', 'REJECTED')]) === 2, 'gate: one report seen twice — a stop and its handback — is one verdict');
  expect(next([launched, once, { ...once, verdict: 'APPROVED' }]) === 0, 'gate: an amendment replaces the verdict it amends');
  expect(next([launched, once, fix(), { ...once }, fix(), report('reviewer', 'REJECTED')]) === 2, 'gate: a report seen again after it was acted on is not a new verdict');
  expect(next([report('reviewer', 'REJECTED'), fix('architect'), report('reviewer', 'REJECTED')]) === 1, 'gate: a round on reviewer → architect is not a round on reviewer → implementer');
  expect(
    next([report('qa', 'FAIL'), fix('reviewer'), report('qa', 'FAIL'), fix(), report('qa', 'FAIL')]) === 2,
    'gate: a dispatch to a stage the loop does not route to leaves its verdicts waiting',
  );
  // A resumed agent: each completion is its own verdict. A message to one still running is not a resume.
  const resumed = (isResumed) => [
    { k: 'dispatch', role: 'reviewer', agent: 'r' },
    { k: 'verdict', role: 'reviewer', verdict: 'REJECTED', agent: 'r', declared: true },
    fix(),
    { k: 'dispatch', role: 'reviewer', agent: 'r', via: 'SendMessage', resumed: isResumed },
    { k: 'verdict', role: 'reviewer', verdict: 'REJECTED', agent: 'r', declared: true },
  ];
  expect(next(resumed(true)) === 2, 'gate: a resumed reviewer rejecting again is a second verdict, not a copy of the first');
  expect(next(resumed(false)) === 0, 'gate: a message to a reviewer still running adds to its run — its report is the one already acted on');
  // Resumed without a fix in between: its approval is no review of a fix, and releases nothing.
  const [rc, rd] = [report('reviewer', 'REJECTED'), report('reviewer', 'APPROVED')];
  expect(
    next([rc[0], rd[0], rc[1], { k: 'dispatch', role: 'reviewer', agent: rd[0].agent, via: 'SendMessage', resumed: true }, { ...rd[1] }, fix(), report('reviewer', 'REJECTED')]) === 2,
    'gate: a sibling resumed with no fix sent in between releases nothing either',
  );
  expect(replay(stuck.slice(0, 4).flat(), loops, forward).rounds.map((r) => r.round).join() === '1,2', 'gate: the replay lists the rounds the dispatches made');

  // Counted per issue where every report names its issues. The graph always said a different issue on
  // the same edge starts its own count; counting the edge, the gate asked about a review that found a new
  // problem each round exactly as about a fix that was not converging.
  const named = (...ids) => report('reviewer', 'REJECTED', { issues: ids });
  expect(next([named('a'), fix(), named('b'), fix(), named('c')]) === 1, 'gate: a new issue each round starts its own count — the edge alone would say 3');
  expect(next([named('a'), fix(), named('a'), fix(), named('a')]) === 3, 'gate: the same issue a third time is round 3');
  expect(next([named('a', 'b'), fix(), named('b'), fix(), named('b')]) === 3, 'gate: an issue keeps its count while the others around it are fixed');
  expect(next([named('a'), fix(), named('b'), fix(), named('a')]) === 2, 'gate: an issue that comes back counts the round it was in before');
  expect(next([named('a'), fix(), named('a'), spoke, named('a')]) === 1, 'gate: the owner speaking starts every issue over too');
  expect(next([named('a'), fix(), report('reviewer', 'APPROVED'), named('a'), fix(), named('a')]) === 2, 'gate: a review that passed closes the issues with the loop');
  // A renamed issue restarts its count, so the edge keeps counting beside it: at twice the cap it asks anyway.
  const renamed = roundsFor([named('a'), fix(), named('b'), fix(), named('c'), fix(), named('d'), fix(), named('e')].flat(), 'implementer', loops, forward)[0];
  expect(renamed?.round === 1 && renamed.edgeRound === 5 && renamed.ceiling === 4 && renamed.issue === 'e', `gate: five rounds of new names are round 1 of the last, and round 5 of an edge whose ceiling is 4 — got ${JSON.stringify(renamed)}`);
  // One report in the round named nothing: nothing says what it was about, so the edge counts it, as before ids.
  const half = () => together(named('a'), report('reviewer', 'REJECTED'));
  expect(next([half(), fix(), half(), fix(), half()]) === 3, 'gate: a round acting on a report that named nothing is counted by its edge');
  expect(roundsFor(stuck.flat(), 'implementer', loops, forward)[0]?.ceiling === 2, 'gate: and an edge counted by itself asks at its cap, not twice it');
  // A round that named nothing advanced no issue's count, so it would buy the loop an extra silent round
  // if the next named one went back to counting by issue. From there the edge counts, until the loop closes.
  expect(next([named('a'), fix(), report('reviewer', 'REJECTED'), fix(), named('a')]) === 3, 'gate: once a round names nothing, the edge counts the rest of the loop');
  expect(next([named('a'), fix(), report('reviewer', 'REJECTED'), fix(), report('reviewer', 'APPROVED'), named('a')]) === 1, 'gate: and a review that passed starts it over, counted by issue again');
  // A late sibling's rejection belongs to the round it was running in, and so do the issues it named.
  const [la, lb] = [named('a'), named('b')];
  expect(next([la[0], lb[0], la[1], fix(), lb[1], fix(), named('b'), fix(), named('b')]) === 3, "gate: a late sibling's issue is counted in the round it belongs to");
  const [ua, ub] = [named('a'), report('reviewer', 'REJECTED')];
  expect(next([ua[0], ub[0], ua[1], fix(), ub[1], fix(), named('c'), fix(), named('d')]) === 3, 'gate: a late sibling that named nothing makes its round, and the rest of the loop, the edge\'s');
  expect(next([named('a'), fix(), named('a'), report('qa', 'PASS'), named('a')]) === 1, 'gate: qa passing closes the issues with the loop it came through');
  // An edge capped at 1: one repeat asks, two new names do not, a third does — the ceiling is twice the cap.
  const cappedAtOne = loopEdges(parseGraph('## Stages\n\n- `reviewer` — r\n- `implementer` — i\n\n## Edges\n\n- `reviewer` → `implementer` on `REJECTED` — x · max 1\n'));
  const atOne = (entries) => roundsFor(entries.flat(), 'implementer', cappedAtOne, new Map())[0];
  const repeat = atOne([named('a'), fix(), named('a')]);
  const two = atOne([named('a'), fix(), named('b')]);
  const three = atOne([named('a'), fix(), named('b'), fix(), named('c')]);
  expect(repeat.round === 2 && repeat.max === 1, 'gate: on an edge capped at 1, the same issue twice is past the cap');
  expect(two.round === 1 && two.edgeRound === 2 && two.ceiling === 2, 'gate: two different issues are not');
  expect(three.edgeRound === 3 && three.ceiling === 2, 'gate: and a third round of new names is past the ceiling');

  const reviewerTokens = new Set(['APPROVED', 'REJECTED']);
  expect(declaredVerdict('VERDICT: REJECTED\nbecause', reviewerTokens) === 'REJECTED', 'gate: a declared verdict is read from the first line');
  expect(declaredVerdict('\n  VERDICT: APPROVED', reviewerTokens) === 'APPROVED', 'gate: leading blank lines and indentation do not hide it');
  expect(declaredVerdict('VERDICT: PASS', reviewerTokens) === null, "gate: another stage's token is not this stage's verdict");
  expect(declaredVerdict('Looks fine. VERDICT: APPROVED', reviewerTokens) === null, 'gate: a verdict anywhere but the first line is not declared');

  const twice = (a, b) => `## Stages\n\n- \`reviewer\` — r\n- \`implementer\` — i\n\n## Edges\n\n- \`reviewer\` → \`implementer\` on \`REJECTED\` — x · max ${a}\n- \`reviewer\` → \`implementer\` on \`REJECTED\` — y · max ${b}\n`;
  expect(validateGraph(parseGraph(twice(2, 3)), new Map()).some((p) => p.includes('one edge, one cap')), 'graph: one edge capped twice, differently, is a problem');
  expect(!validateGraph(parseGraph(twice(2, 2)), new Map()).some((p) => p.includes('one edge, one cap')), 'graph: the same edge from the core and a surface with one cap is fine');
  expect(loopEdges(parseGraph(twice(2, 3))).get('reviewer').get('REJECTED').get('implementer') === 3, 'gate: two caps on one edge read as the larger — the reading that cannot block work');
}

// ─── the loop gate: the hooks, one event at a time ───────────────────────────────────────
{
  const data = await scratch();
  const before = process.env.NINA_DATA;
  process.env.NINA_DATA = data;

  const project = await scratch();
  await mkdir(join(project, '.claude', 'agents'), { recursive: true });
  await mkdir(join(project, '.nina'), { recursive: true });
  await writeFile(join(project, '.nina', 'profile.json'), JSON.stringify({ core: 'dev', surfaces: [], vocabulary: {} }));
  await writeFile(
    join(project, '.claude', 'graph.md'),
    '## Stages\n\n- `reviewer` — r\n- `implementer` — i\n- `architect` — a\n\n## Edges\n\n' +
      '- `implementer` → `reviewer` on `DIFF-READY`\n- `reviewer` → `done` on `APPROVED`\n' +
      '- `reviewer` → `implementer` on `REJECTED` — a bug · max 2\n- `reviewer` → `architect` on `REJECTED` — a flaw · max 2\n' +
      '- `architect` → `implementer` on `SPEC-READY`\n',
  );
  const spec = (...tokens) => `---\nname: x\ntools: Read\n---\n\nwhere \`<TOKEN>\` is one of ${tokens.map((t) => `\`${t}\``).join(' or ')}.\n`;
  await writeFile(join(project, '.claude', 'agents', 'reviewer.md'), spec('APPROVED', 'REJECTED'));
  await writeFile(join(project, '.claude', 'agents', 'implementer.md'), spec('DIFF-READY', 'BLOCKED'));
  await writeFile(join(project, '.claude', 'agents', 'architect.md'), spec('SPEC-READY', 'BLOCKED'));

  const session = 's-gate';
  const hook = (event, fields = {}) => handle({ hook_event_name: event, session_id: session, ...fields }, { root: project });
  let tool = 0;
  // A stage as it really reports: it hands its report back itself, then writes a comment and stops.
  const send = (role, agent) => {
    const id = `toolu_${(tool += 1)}`;
    const answer = hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: role }, tool_use_id: id });
    if (!answer) hook('PostToolUse', { tool_name: 'Agent', tool_input: { subagent_type: role }, tool_use_id: id, tool_response: { agentId: agent } });
    return answer;
  };
  const reviewed = (agent, report) => {
    send('reviewer', agent);
    hook('PostToolUse', { tool_name: 'SubagentHandback', agent_id: agent, agent_type: 'reviewer', tool_input: { message: report } });
    return hook('SubagentStop', { agent_type: 'reviewer', agent_id: agent, last_assistant_message: 'Handed back.', stop_hook_active: false });
  };

  expect(reviewed('r1', 'VERDICT: REJECTED\nthe null check is missing') === null, 'gate: a stop after a handback says nothing');
  expect(send('implementer', 'i1') === null, 'gate: round 1 goes out');
  reviewed('r2', 'VERDICT: REJECTED\nstill missing');
  expect(send('implementer', 'i2') === null, 'gate: round 2 of 2 goes out, and the hook says nothing');
  reviewed('r3', 'VERDICT: REJECTED\nstill missing');
  const asked = send('implementer', 'i3');
  const reason = asked?.hookSpecificOutput?.permissionDecisionReason ?? '';
  expect(
    asked?.hookSpecificOutput?.permissionDecision === 'ask' && reason.includes('round 3') && reason.includes('reviewer → implementer'),
    `gate: round 3 against a cap of 2 goes to the owner to confirm — got ${JSON.stringify(asked)}`,
  );
  expect(reason.includes('r1, r2, r3'), "gate: the question names each round's report, so they can be looked at");
  expect(
    hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'i2' } })?.hookSpecificOutput?.permissionDecision === 'ask',
    'gate: resuming the fixer is the same round, and asks too',
  );
  expect(
    hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'implementer' } })?.hookSpecificOutput?.permissionDecision === 'ask' &&
      hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'implementer [3fa9c1]' } })?.hookSpecificOutput?.permissionDecision === 'ask',
    'gate: and so does resuming it by name, as a listing prints it or not',
  );
  // The recipient is whatever the model wrote, read on every dispatch: its ` [ref]` is found by position,
  // because the pattern that did it took half a second on 20,000 `[` and grew with the square.
  const slow = Date.now();
  hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: '['.repeat(60_000) } });
  expect(Date.now() - slow < 1000, `gate: a recipient of 60,000 \`[\` is read in linear time — took ${Date.now() - slow}ms`);
  expect(send('architect', 'a1') === null, 'gate: the cap holds one edge — the design route is still open');
  expect(hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } }) === null, 'gate: an agent that is not a stage is never held');
  expect(
    hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'implementer' }, agent_id: 'nested' }) === null,
    "gate: a dispatch made inside a subagent is not the pipeline's",
  );
  // Claude Code runs UserPromptSubmit when a report is delivered, as well as when the owner types.
  reviewed('r4', 'VERDICT: REJECTED\nstill missing');
  hook('UserPromptSubmit', { prompt: '<agent-message from="r4">\n[Subagent hand-back] VERDICT: REJECTED' });
  hook('UserPromptSubmit', { prompt: 'Another Claude session sent a message:\n<agent-message from="r4">' });
  hook('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>x</task-id>' });
  expect(send('implementer', 'i4')?.hookSpecificOutput?.permissionDecision === 'ask', 'gate: a report being delivered is not the owner speaking — the count stands');
  hook('PostToolUse', { tool_name: 'AskUserQuestion' });
  expect(send('implementer', 'i5') === null, 'gate: the owner answering a question starts the count over');
  reviewed('r5', 'VERDICT: REJECTED');
  send('implementer', 'i6');
  reviewed('r6', 'VERDICT: REJECTED');
  hook('UserPromptSubmit', { prompt: 'try one more time' });
  expect(send('implementer', 'i7') === null, 'gate: and so does the owner writing a message');

  // The text-first report — the one shape where the stop carries the verdict itself — is read there.
  expect(hook('SubagentStop', { agent_type: 'reviewer', agent_id: 'r8', last_assistant_message: 'VERDICT: APPROVED\nfine', stop_hook_active: false }) === null, 'gate: a stop carrying the report says nothing');
  const ledger = readLedger(ledgerPath(project, session));
  expect(ledger.some((e) => e.k === 'verdict' && e.agent === 'r8' && e.verdict === 'APPROVED'), 'gate: and its verdict is recorded from the stop');
  expect(ledger.filter((e) => e.k === 'verdict' && e.agent === 'r1').length === 1, 'gate: a handback and the stop after it are one verdict on the ledger');
  hook('PostToolUse', { tool_name: 'SubagentHandback', agent_id: 'r8', agent_type: 'reviewer', tool_input: { message: 'VERDICT: APPROVED\nfine' } });
  expect(
    readLedger(ledgerPath(project, session)).filter((e) => e.k === 'verdict' && e.agent === 'r8').length === 1,
    'gate: and so are a stop carrying the report and the handback Claude Code asks for after it',
  );
  expect(!JSON.stringify(ledger).includes('null check'), "gate: the ledger holds metadata, never a report's words");

  // When the handback's own hook recorded nothing, the stop finds the handback in the subagent's transcript
  // — the one of its current completion, not one from before it was resumed.
  const agentLog = join(project, 'agent-h1.jsonl');
  const row = (type, content) => JSON.stringify({ type, message: { content } });
  await writeFile(
    agentLog,
    [
      row('user', 'review the diff'),
      row('assistant', [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'VERDICT: APPROVED\nfine' } }]),
      row('assistant', [{ type: 'text', text: 'Handed back.' }]),
      '',
    ].join('\n'),
  );
  hook('SubagentStop', { agent_type: 'reviewer', agent_id: 'h1', last_assistant_message: 'Handed back.', stop_hook_active: false, agent_transcript_path: agentLog });
  expect(readLedger(ledgerPath(project, session)).some((e) => e.agent === 'h1' && e.verdict === 'APPROVED'), 'gate: a stop after a handback its hook missed reads it from the subagent transcript');
  await writeFile(agentLog, `${await readFile(agentLog, 'utf8')}${row('user', 'look again')}\n${row('assistant', [{ type: 'text', text: 'Nothing more.' }])}\n`);
  hook('PostToolUse', { tool_name: 'SendMessage', tool_input: { to: 'h1' }, tool_response: { resumedAgentId: 'h1' } });
  hook('SubagentStop', { agent_type: 'reviewer', agent_id: 'h1', last_assistant_message: 'Nothing more.', stop_hook_active: false, agent_transcript_path: agentLog });
  expect(
    readLedger(ledgerPath(project, session)).filter((e) => e.agent === 'h1' && e.k === 'verdict').length === 1,
    "gate: a resumed agent's old handback is not read as the new completion's report",
  );

  // By hand, through the CLI: a hook's stdout is its answer, so nothing may come before the JSON.
  reviewed('r9', 'VERDICT: REJECTED');
  send('implementer', 'i8');
  reviewed('r10', 'VERDICT: REJECTED');
  send('implementer', 'i9');
  reviewed('r11', 'VERDICT: REJECTED');
  const byHand = spawnSync(process.execPath, [NINA, 'gate', '--hook', '--project', project], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Agent', tool_input: { subagent_type: 'implementer' } }),
    encoding: 'utf8',
  });
  let byHandAnswer = null;
  try {
    byHandAnswer = JSON.parse(byHand.stdout);
  } catch {
    // Reported below.
  }
  expect(byHandAnswer?.hookSpecificOutput?.permissionDecision === 'ask', `gate --hook: prints the answer and nothing before it — got ${byHand.stdout.slice(0, 120)}`);
  expect(readLedger(ledgerPath(project, session)).filter((e) => e.k === 'ask').length === 6, 'gate: every question put to the owner is on the ledger');

  // A pin whose version ships no gate: the composed file may still be on disk, and it does nothing.
  const old = await scratch();
  await cp(project, old, { recursive: true });
  await writeFile(join(old, '.nina', 'profile.json'), JSON.stringify({ core: '0.1.0', surfaces: [], vocabulary: {} }));
  expect(
    handle({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' }, { root: old }) === null && !existsSync(projectGateDir(old)),
    'gate: a project pinned to a version with no gate is left alone, whatever is on disk',
  );

  // The ids a report gave its issues go into the ledger with its verdict; a pass records none.
  const named = (agent, report) =>
    handle({ hook_event_name: 'PostToolUse', session_id: 's-issues', tool_name: 'SubagentHandback', agent_id: agent, agent_type: 'reviewer', tool_input: { message: report } }, { root: project });
  named('n1', 'VERDICT: REJECTED\nISSUES: Missing Null Check, wrong-status\nbody');
  named('n2', 'VERDICT: APPROVED\nISSUES: leftover\nbody');
  const [rejected, approved] = readLedger(ledgerPath(project, 's-issues')).filter((e) => e.k === 'verdict');
  expect(JSON.stringify(rejected?.issues) === '["missing-null-check","wrong-status"]', `gate: a rejection's issue ids are recorded with it — got ${JSON.stringify(rejected)}`);
  expect(approved && !('issues' in approved), 'gate: a pass records no issues, whatever it wrote under its verdict');
  // The same ids arrive by the other two ways a report reaches the gate: the stop's last message, and the
  // handback read back from the subagent's own transcript when its last message was a comment.
  hook('PreToolUse', { session_id: 's-issues', tool_name: 'Agent', tool_input: { subagent_type: 'reviewer' }, tool_use_id: 'toolu_s1' });
  handle({ hook_event_name: 'SubagentStop', session_id: 's-issues', agent_type: 'reviewer', agent_id: 'n3', last_assistant_message: 'VERDICT: REJECTED\nISSUES: from-the-stop', stop_hook_active: false }, { root: project });
  const transcript = join(await scratch(), 'agent-n4.jsonl');
  await writeFile(transcript, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'VERDICT: REJECTED\nISSUES: from-the-transcript' } }] } })}\n`);
  handle({ hook_event_name: 'SubagentStop', session_id: 's-issues', agent_type: 'reviewer', agent_id: 'n4', last_assistant_message: 'Handed back.', agent_transcript_path: transcript, stop_hook_active: false }, { root: project });
  const stopped = readLedger(ledgerPath(project, 's-issues')).filter((e) => e.k === 'verdict').map((e) => e.issues?.join()).slice(2).join('|');
  expect(stopped === 'from-the-stop|from-the-transcript', `gate: ids are recorded from a stop and from a handback read back — got ${stopped}`);

  // The decision, per issue: a third round of one issue asks and names it; a third round of new ones does not.
  const loop = (sid, reports) => {
    const h = (event, fields = {}) => handle({ hook_event_name: event, session_id: sid, ...fields }, { root: project });
    let answer = null;
    reports.forEach((report, i) => {
      const agent = `${sid}-r${i}`;
      h('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'reviewer' }, tool_use_id: `${sid}-u${i}` });
      h('PostToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'reviewer' }, tool_use_id: `${sid}-u${i}`, tool_response: { agentId: agent } });
      h('PostToolUse', { tool_name: 'SubagentHandback', agent_id: agent, agent_type: 'reviewer', tool_input: { message: report } });
      answer = h('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'implementer' }, tool_use_id: `${sid}-f${i}` });
      if (!answer) h('PostToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'implementer' }, tool_use_id: `${sid}-f${i}`, tool_response: { agentId: `${sid}-i${i}` } });
    });
    return answer;
  };
  const same = loop('s-same', ['a', 'b', 'c'].map(() => 'VERDICT: REJECTED\nISSUES: null-check-missing\nstill missing'));
  expect(
    same?.hookSpecificOutput?.permissionDecision === 'ask' && same.hookSpecificOutput.permissionDecisionReason.includes('round 3 of the issue `null-check-missing`'),
    `gate: a third round of one named issue goes to the owner, and the question names the issue — got ${JSON.stringify(same)}`,
  );
  expect(
    readLedger(ledgerPath(project, 's-same')).some((e) => e.k === 'ask' && e.issue === 'null-check-missing' && e.edge_round === 3),
    'gate: the ask is written down with the issue that decided it',
  );
  expect(loop('s-new', ['a', 'b', 'c'].map((id) => `VERDICT: REJECTED\nISSUES: problem-${id}`)) === null, 'gate: a third round of new issues goes out without asking');
  const ceiling = loop('s-ceiling', ['a', 'b', 'c', 'd', 'e'].map((id) => `VERDICT: REJECTED\nISSUES: problem-${id}`));
  expect(
    ceiling?.hookSpecificOutput?.permissionDecision === 'ask' && ceiling.hookSpecificOutput.permissionDecisionReason.includes('No issue has passed the cap of 2'),
    `gate: the fifth round of new names asks anyway, and says why — got ${JSON.stringify(ceiling)}`,
  );

  // It fails open, and writes the failure where the selftest looks.
  const broken = await scratch();
  await cp(join(project, '.nina'), join(broken, '.nina'), { recursive: true });
  await mkdir(join(broken, '.claude', 'graph.md'), { recursive: true });
  expect(
    handle({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Agent', tool_input: { subagent_type: 'implementer' } }, { root: broken }) === null,
    'gate: an error lets the call through',
  );
  expect(existsSync(join(projectGateDir(broken), 'errors.jsonl')), 'gate: and is written down for the selftest to report');
  const plain = await scratch();
  await cp(join(project, '.nina'), join(plain, '.nina'), { recursive: true });
  expect(
    handle({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' }, { root: plain }) === null && !existsSync(projectGateDir(plain)),
    'gate: a project with no graph has no caps, and gets no ledger',
  );

  if (before === undefined) delete process.env.NINA_DATA;
  else process.env.NINA_DATA = before;
}

// ─── the loop gate, end to end: the composed script, run by the exact hook command ───────
{
  const data = await scratch();
  const before = process.env.NINA_DATA;
  process.env.NINA_DATA = data;
  const bed = await sound('plain', 'dev');
  const settings = JSON.parse(await readFile(join(bed, '.claude', 'settings.json'), 'utf8'));
  const commandFor = (event) => settings.hooks[event].flatMap((g) => g.hooks.map((h) => h.command)).find((c) => c.includes('loop-gate.mjs'));
  const fire = (event, fields = {}, input = null) => {
    const r = spawnSync('sh', ['-c', commandFor(event)], {
      input: input ?? JSON.stringify({ hook_event_name: event, session_id: 's-e2e', ...fields }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: bed, NINA_DATA: data },
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };

  const cap = loopEdges(parseGraph(await readFile(join(bed, '.claude', 'graph.md'), 'utf8'))).get('reviewer')?.get('REJECTED')?.get('implementer');
  expect(cap === 2, `gate e2e: the composed core graph caps reviewer → implementer at 2 — got ${cap}`);
  const launch = (role, agent) => {
    fire('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: role }, tool_use_id: `toolu_${agent}` });
    fire('PostToolUse', { tool_name: 'Agent', tool_input: { subagent_type: role }, tool_use_id: `toolu_${agent}`, tool_response: { agentId: agent } });
  };
  for (let i = 1; i <= (cap ?? 2); i += 1) {
    launch('reviewer', `r${i}`);
    fire('PostToolUse', { tool_name: 'SubagentHandback', agent_id: `r${i}`, agent_type: 'reviewer', tool_input: { message: 'VERDICT: REJECTED\nimplementer' } });
    fire('SubagentStop', { agent_type: 'reviewer', agent_id: `r${i}`, last_assistant_message: 'done', stop_hook_active: false });
    launch('implementer', `i${i}`);
  }
  launch('reviewer', 'r9');
  fire('SubagentStop', { agent_type: 'reviewer', agent_id: 'r9', last_assistant_message: 'VERDICT: REJECTED\nimplementer', stop_hook_active: false });
  const held = fire('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'implementer' }, tool_use_id: 'toolu_e2e' });
  let answer = null;
  try {
    answer = JSON.parse(held.out);
  } catch {
    // Reported below.
  }
  expect(
    held.status === 0 && answer?.hookSpecificOutput?.permissionDecision === 'ask',
    `gate e2e: the composed script, run by the hook command, sends the round past the cap to the owner — got ${held.status} ${held.out}${held.err}`,
  );
  fire('UserPromptSubmit', { prompt: '<agent-message from="r9">report</agent-message>' });
  expect(fire('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'implementer' }, tool_use_id: 'toolu_e2e2' }).out !== '', 'gate e2e: a delivered report does not reset it');
  fire('UserPromptSubmit', { prompt: 'go on' });
  const after = fire('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'implementer' }, tool_use_id: 'toolu_e2e3' });
  expect(after.status === 0 && after.out === '', 'gate e2e: once the owner speaks it goes out, and the hook prints nothing at all');
  expect(existsSync(join(data, 'gate')), 'gate e2e: the ledger is where NINA_DATA says, not in the home directory');

  const self = run(['gate', '--selftest', '--project', bed], { loud: true });
  expect(self.status === 0 && self.out.includes('gate: current'), `gate: the selftest passes on a wired bed — got ${self.status}\n${self.out}`);
  const learned = run(['learn', '--project', bed], { loud: true });
  expect(
    /loops\s+2 round\(s\) on capped edges in 1 session\(s\).*the longest 2 · 2 sent to you at the cap/.test(learned.out),
    `learn: reports the rounds the gate counted and what it put to the owner — got ${learned.out}`,
  );

  // Unwired: the selftest says so, and `wire` puts it back without touching anything else.
  const trimmed = {
    permissions: { allow: ['Bash(ls)'] },
    hooks: Object.fromEntries(
      Object.entries(settings.hooks)
        .map(([event, groups]) => [event, groups.filter((g) => !g.hooks.some((h) => h.command.includes('loop-gate.mjs')))])
        .filter(([, groups]) => groups.length > 0),
    ),
  };
  await writeFile(join(bed, '.claude', 'settings.json'), `${JSON.stringify(trimmed, null, 2)}\n`);
  const unwired = run(['gate', '--selftest', '--project', bed], { loud: true });
  expect(unwired.status === 1 && unwired.out.includes('no PreToolUse hook'), `gate: the selftest names a missing gate hook — got ${unwired.out}`);
  const preview = run(['wire', '--project', bed], { loud: true });
  expect(preview.status === 1 && preview.out.includes('"PreToolUse"') && preview.out.includes('loop-gate.mjs'), 'wire: names what is missing and prints the hooks to merge');
  const applied = run(['wire', '--project', bed, '--apply'], { loud: true });
  const merged = JSON.parse(await readFile(join(bed, '.claude', 'settings.json'), 'utf8'));
  expect(
    applied.status === 0 && merged.permissions?.allow?.[0] === 'Bash(ls)' && JSON.stringify(merged.hooks).includes('loop-gate.mjs') && JSON.stringify(merged.hooks).includes('--context'),
    `wire --apply: merges the missing hooks and keeps everything already there — got ${applied.status}\n${applied.out}`,
  );
  expect(run(['wire', '--project', bed]).status === 0, 'wire: and then there is nothing left to wire');

  // A gate that fails lets the call through and prints nothing — and the selftest says so, once.
  const garbage = fire('PreToolUse', {}, 'not json');
  expect(garbage.status === 0 && garbage.out === '', 'gate e2e: garbage in lets the call through and prints nothing');
  const failing = run(['gate', '--selftest', '--project', bed], { loud: true });
  expect(failing.status === 1 && failing.out.includes('failed 1 time'), `gate: the selftest reports a gate that has been failing — got ${failing.out}`);
  expect(run(['gate', '--selftest', '--project', bed]).status === 0, 'gate: and reports each failure once, not on every turn');

  // A gate script that runs and holds nothing — wired, writable, never failing — is what only the dry
  // run can catch.
  const gatePath = join(bed, 'scripts', 'loop-gate.mjs');
  const realGate = await readFile(gatePath, 'utf8');
  await writeFile(gatePath, '#!/usr/bin/env node\nprocess.stdin.resume();\n');
  const hollow = run(['gate', '--selftest', '--project', bed], { loud: true });
  expect(hollow.status === 1 && hollow.out.includes('in a dry run'), `gate: the selftest's dry run catches a gate that holds nothing — got ${hollow.out}`);
  await writeFile(gatePath, realGate);

  // A ledger the gate cannot write means no cap is held; the dry run's scratch directory would hide it.
  const blocked = await scratch();
  await writeFile(join(blocked, 'gate'), 'a file where the directory should be\n');
  const cannot = spawnSync(process.execPath, [NINA, 'gate', '--selftest', '--project', bed, '--quiet'], { encoding: 'utf8', env: { ...process.env, NINA_DATA: blocked } });
  expect(cannot.status === 1 && cannot.stdout.includes('cannot write its ledger'), `gate: the selftest checks the real ledger is writable — got ${cannot.stdout}`);

  if (before === undefined) delete process.env.NINA_DATA;
  else process.env.NINA_DATA = before;
}

// ─── upgrade: a version that adds a hooked script waits for its hooks ────────────────────
{
  // Built on releases this test cuts itself, so it holds whatever the newest real pair happens to be.
  const nina = await scratch();
  for (const part of ['bin', 'src']) await cp(join(ROOT, part), join(nina, part), { recursive: true });
  await writeFile(
    join(nina, 'package.json'),
    `${JSON.stringify({ name: '@xhulz/nina', version: '0.0.0', type: 'module', exports: { './detectors': './src/detectors.mjs', './gate': './src/gate.mjs', './package.json': './package.json' } }, null, 2)}\n`,
  );
  await mkdir(join(nina, 'surfaces'), { recursive: true });
  await mkdir(join(nina, 'core', 'tree', 'scripts'), { recursive: true });
  // One owed document from the start, so `check` fails before every move — which is the case the
  // upgrade used to excuse whole, whatever else the move broke.
  const claude = '# Bed\n\nRead `.claude/architecture.md`.\n';
  await writeFile(join(nina, 'core', 'tree', 'CLAUDE.md'), claude);
  await writeFile(
    join(nina, 'core', 'tree', 'scripts', 'harness-check.mjs'),
    "#!/usr/bin/env node\nimport { runDetectors } from '@xhulz/nina/detectors';\nprocess.exit(runDetectors([], { root: process.cwd() }));\n",
  );
  const cut = async (version) => {
    const log = console.log;
    console.log = () => {};
    await release([version], { root: nina });
    console.log = log;
  };
  await cut('2.0.0');
  // The gate comes with the graph it holds: a core that shipped one without the other would owe the
  // project a file it cannot write, and `check` rightly says so.
  await cp(join(ROOT, 'core', 'tree', 'scripts', 'loop-gate.mjs'), join(nina, 'core', 'tree', 'scripts', 'loop-gate.mjs'));
  await mkdir(join(nina, 'core', 'tree', '.claude'), { recursive: true });
  await writeFile(join(nina, 'core', 'tree', '.claude', 'graph.md'), '# Graph\n\n## Stages\n\n## Edges\n');
  await cut('2.1.0');
  await writeFile(join(nina, 'core', 'tree', 'CLAUDE.md'), '# Bed\n\nRead `.claude/architecture.md` and `.claude/code-map.md`.\n');
  await writeFile(join(nina, 'core', 'tree', '.claude', 'extra.md'), '# Extra\n');
  await cut('2.2.0');
  await writeFile(join(nina, 'core', 'tree', 'CLAUDE.md'), `${claude}\n<!-- nina:slot project.1 added -->\n`);
  await rm(join(nina, 'core', 'tree', '.claude', 'extra.md'));
  await cut('2.3.0');

  const dir = await scratch();
  await mkdir(join(dir, '.nina', 'project', 'tree'), { recursive: true });
  await writeFile(join(dir, '.nina', 'profile.json'), `${JSON.stringify({ core: '2.0.0', surfaces: [], vocabulary: {} }, null, 2)}\n`);
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name: 'bed', private: true, scripts: { 'harness:check': 'node scripts/harness-check.mjs', 'harness:compose:check': 'nina compose --check --quiet' } }, null, 2)}\n`);
  await mkdir(join(dir, 'node_modules', '@xhulz'), { recursive: true });
  await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
  await symlink(nina, join(dir, 'node_modules', '@xhulz', 'nina'));
  await symlink(join(nina, 'bin', 'nina.mjs'), join(dir, 'node_modules', '.bin', 'nina'));
  await mkdir(join(dir, '.claude'), { recursive: true });
  const own = JSON.parse(settingsFile(new Set(['scripts/harness-check.mjs'])));
  await writeFile(join(dir, '.claude', 'settings.json'), `${JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, ...own }, null, 2)}\n`);
  const bed = (args) => {
    const r = spawnSync(process.execPath, [join(nina, 'bin', 'nina.mjs'), ...args, '--quiet'], { encoding: 'utf8', cwd: dir });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const pinned = async () => JSON.parse(await readFile(join(dir, '.nina', 'profile.json'), 'utf8')).core;

  expect(bed(['compose', '--project', dir]).status === 0, 'upgrade wiring: the bed composes at 2.0.0');
  const preview = bed(['upgrade', '--project', dir, '--to', '2.1.0']);
  expect(
    preview.status === 1 && preview.out.includes('nina wire --to 2.1.0 --apply') && preview.out.includes('loop-gate.mjs'),
    `upgrade: a move that composes a hooked script for the first time names the hooks it needs — got ${preview.out}`,
  );
  expect(bed(['upgrade', '--project', dir, '--to', '2.1.0', '--apply']).status === 1 && (await pinned()) === '2.0.0', 'upgrade: and refuses to move without them');
  expect(bed(['upgrade', '--project', dir, '--to', '2.1.0', '--apply', '--force']).status === 1 && (await pinned()) === '2.0.0', 'upgrade: --force does not skip them');
  const wired = bed(['wire', '--project', dir, '--to', '2.1.0', '--apply']);
  const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
  expect(
    wired.status === 0 && settings.permissions?.allow?.[0] === 'Bash(ls)' && JSON.stringify(settings.hooks).includes('loop-gate.mjs'),
    `wire --to: wires a version before it is pinned, keeping what is there — got ${wired.out}`,
  );
  const moved = bed(['upgrade', '--project', dir, '--to', '2.1.0', '--apply']);
  expect(moved.status === 0 && (await pinned()) === '2.1.0', `upgrade: wired, it moves — and a step failing as before is excused — got ${moved.out}`);

  // The same step failing as before AND with something new is not excused: that is what the move did.
  // And rolling it back puts the tree back as it was — the owner's own edit to a composed file included.
  await writeFile(join(dir, 'CLAUDE.md'), `${await readFile(join(dir, 'CLAUDE.md'), 'utf8')}\nan edit of ours\n`);
  const worse = bed(['upgrade', '--project', dir, '--to', '2.2.0', '--apply']);
  expect(
    worse.status === 1 && worse.out.includes('now also') && (await pinned()) === '2.1.0',
    `upgrade: a step that was failing and now fails with something new rolls the move back — got ${worse.status}\n${worse.out}`,
  );
  expect(!existsSync(join(dir, '.claude', 'extra.md')), 'upgrade: and the rollback removes the files the move composed');
  expect((await readFile(join(dir, 'CLAUDE.md'), 'utf8')).includes('an edit of ours'), "upgrade: a rollback keeps the owner's own edits, rather than recomposing over them");

  // A file the project wrote, where the new version starts composing one: refused, and never lost.
  await writeFile(join(dir, '.claude', 'extra.md'), 'mine\n');
  const occupied = bed(['upgrade', '--project', dir, '--to', '2.2.0']);
  expect(occupied.status === 1 && occupied.out.includes('.claude/extra.md'), `upgrade: the preview names a file of the project's own that the move would replace — got ${occupied.out}`);
  // Sound before the move, so the new owed document fails the check outright and even --force rolls back.
  await writeFile(join(dir, '.claude', 'architecture.md'), '# Architecture\n');
  const forcedBack = bed(['upgrade', '--project', dir, '--to', '2.2.0', '--apply', '--force']);
  expect(
    forcedBack.status === 1 && (await readFile(join(dir, '.claude', 'extra.md'), 'utf8')) === 'mine\n' && (await pinned()) === '2.1.0',
    `upgrade: a move that replaced a file of the project's own puts it back when it rolls back — got ${forcedBack.status}\n${forcedBack.out}`,
  );
  expect(
    (await readFile(join(dir, '.nina', 'replaced', '.claude', 'extra.md'), 'utf8').catch(() => '')) === 'mine\n',
    "upgrade: and keeps a copy on disk, where an interrupted move cannot lose it",
  );
  await rm(join(dir, '.claude', 'extra.md'));

  // A note is not a failure: a slot the move creates must not roll it back, however the step was doing.
  const noted = bed(['upgrade', '--project', dir, '--to', '2.3.0', '--apply']);
  expect(noted.status === 0 && (await pinned()) === '2.3.0', `upgrade: a new slot, reported as a note, never rolls a move back — got ${noted.status}\n${noted.out}`);

  // Moving back: the files the older version does not compose are removed, the gate first among them —
  // except one carrying the project's own edits, which is kept and named.
  await writeFile(join(dir, '.claude', 'graph.md'), `${await readFile(join(dir, '.claude', 'graph.md'), 'utf8')}\nan edit of ours\n`);
  const back = bed(['upgrade', '--project', dir, '--to', '2.0.0', '--apply']);
  expect(
    back.status === 0 && (await pinned()) === '2.0.0' && !existsSync(join(dir, 'scripts', 'loop-gate.mjs')),
    `upgrade: a move removes what the version it moves to does not compose — got ${back.status}\n${back.out}`,
  );
  expect(existsSync(join(dir, '.claude', 'graph.md')) && back.out.includes('kept 1 file(s)'), `upgrade: but not a file with edits of the project's own — got ${back.out}`);
}

// ─── wiring: a hook counts only where Claude Code would run it ───────────────────────────
{
  const dir = await scratch();
  await mkdir(join(dir, '.claude'), { recursive: true });
  const gateOnly = new Set(['scripts/loop-gate.mjs']);
  const withMatcher = async (matcher) => {
    const all = JSON.parse(settingsFile(gateOnly));
    for (const g of all.hooks.PreToolUse) g.matcher = matcher;
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify(all));
    return (await missingWiring(dir, gateOnly)).filter((w) => w.includes('PreToolUse'));
  };
  expect((await withMatcher('Bash')).length === 1, 'wiring: a gate hook matching the wrong tool is not wired');
  expect((await withMatcher('Agent')).length === 1, 'wiring: one matching Agent alone lets a resumed fixer through');
  expect((await withMatcher('SendMessage|Task|Agent')).length === 0, 'wiring: the tools may come in any order');
  expect((await withMatcher('*')).length === 0, 'wiring: a matcher of * reaches every tool');
  expect((await withMatcher('Agent | Task | SendMessage')).length === 1, 'wiring: spaces make it a regular expression that reaches none of them');
  expect((await withMatcher('(Agent|Task|SendMessage)')).length === 0 && (await withMatcher('.*')).length === 0, 'wiring: a regular expression that reaches them is wired');
  expect(matcherReaches('Agent|Task', 'Agent') && !matcherReaches('Agent|Task', 'AgentX') && matcherReaches(undefined, 'Agent'), 'wiring: exact names are exact');

  for (const hooks of ['x', null, [], { PreToolUse: {} }]) {
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks }));
    let said = null;
    try {
      said = await missingWiring(dir, gateOnly);
    } catch (error) {
      said = `threw: ${error.message}`;
    }
    expect(Array.isArray(said), `wiring: settings with hooks ${JSON.stringify(hooks)} are reported, not thrown — got ${said}`);
    const applied = await applyWiring(dir, gateOnly).catch((error) => ({ threw: error.message }));
    expect(!applied.threw, `wiring: and merging into them does not throw — got ${applied.threw}`);
  }
}

// ─── snapshot: a dispatch that was denied is not a run ───────────────────────────────────
{
  const dir = await scratch();
  const denial = (id, uuid, content, kind) => JSON.stringify({ type: 'user', uuid, timestamp: '2026-09-23T10:00:01.000Z', ...(kind ? { toolDenialKind: kind } : {}), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content }] } });
  const dispatch = (id, uuid) => JSON.stringify({ type: 'assistant', uuid, timestamp: '2026-09-23T10:00:00.000Z', sessionId: 's', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'implementer' } }] } });
  await writeFile(
    join(dir, 'session.jsonl'),
    [
      dispatch('toolu_a', 'a1'),
      denial('toolu_a', 'a2', 'PreToolUse:Agent hook error: Loop cap reached.', 'permission-rule'),
      dispatch('toolu_b', 'b1'),
      denial('toolu_b', 'b2', 'Loop cap reached: `reviewer` → `implementer` on `REJECTED` allows 2 round(s)', null),
      dispatch('toolu_c', 'c1'),
      denial('toolu_c', 'c2', 'The user rejected this.', 'user-rejected'),
      '',
    ].join('\n'),
  );
  const { records } = await scanProject(dir, {});
  expect(records.length === 3 && records.every((r) => r.status === 'denied'), `snapshot: a dispatch denied by a hook, a rule or the person is marked denied — got ${records.map((r) => r.status).join()}`);
}

// ─── snapshot: how many issues a loop-back named, and never which ─────────────────────────
{
  const dir = await scratch();
  const dispatch = (id, role) => JSON.stringify({ type: 'assistant', uuid: `${id}-d`, timestamp: '2026-09-24T10:00:00.000Z', sessionId: 's', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: role } }] } });
  const result = (id, report) => JSON.stringify({ type: 'user', uuid: `${id}-r`, timestamp: '2026-09-24T10:05:00.000Z', message: { content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<result>${report}</result>\n</task-notification>` } });
  await writeFile(
    join(dir, 'session.jsonl'),
    [
      dispatch('toolu_n', 'reviewer'),
      result('toolu_n', 'VERDICT: REJECTED\nISSUES: missing-null-check, wrong-status\nbody'),
      dispatch('toolu_z', 'reviewer'),
      result('toolu_z', 'VERDICT: REJECTED\nthe null check is missing'),
      dispatch('toolu_p', 'qa'),
      result('toolu_p', 'VERDICT: PASS\nISSUES: none'),
      '',
    ].join('\n'),
  );
  const { records } = await scanProject(dir, {});
  const by = Object.fromEntries(records.map((r) => [r.dispatch_id, r.issues]));
  expect(by.toolu_n === 2, `snapshot: a loop-back that named two issues records 2 — got ${by.toolu_n}`);
  expect(by.toolu_z === 0, `snapshot: one that named none records 0, so the gap is countable — got ${by.toolu_z}`);
  expect(by.toolu_p === null, `snapshot: a pass is not asked for issues, and records none — got ${by.toolu_p}`);
  expect(!JSON.stringify(records).includes('missing-null-check'), 'snapshot: the ids themselves never reach the record');
}

// ─── vocabulary: a release answers for its own stack, and a project declares a name to change it ───
{
  expect(JSON.stringify(defaultVocabulary(join(ROOT, 'releases', '0.22.0'))) === '{}', 'vocabulary: a release from before the defaults supplies none, as it always did');
  expect(defaultVocabulary(ROOT).TYPECHECK_CMD === 'pnpm typecheck', 'vocabulary: the working core supplies the stack commands');

  const dir = await scratch();
  run(['init', '--project', dir, '--surfaces', 'frontend', '--core', 'dev']);
  const profilePath = join(dir, '.nina', 'profile.json');
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));
  expect(!('TYPECHECK_CMD' in profile.vocabulary) && !('TEST_CMD' in profile.vocabulary), `vocabulary: init asks for no name the release answers — got ${Object.keys(profile.vocabulary).join(', ')}`);
  const todo = await readFile(join(dir, '.nina', 'TODO.md'), 'utf8');
  expect(todo.includes('- `TYPECHECK_CMD` — `pnpm typecheck`'), 'vocabulary: the TODO says what each default is, so a project on another stack can change it');
  const reviewer = () => readFile(join(dir, '.claude', 'agents', 'reviewer.md'), 'utf8');
  expect((await reviewer()).includes('- `pnpm typecheck` for the affected packages'), 'vocabulary: a name the project did not declare composes as the default');
  expect(!run(['check', '--project', dir], { loud: true }).out.includes('TYPECHECK_CMD'), 'vocabulary: check does not ask for a name that has a default');

  await writeFile(profilePath, JSON.stringify({ ...profile, vocabulary: { ...profile.vocabulary, TYPECHECK_CMD: 'uv run mypy .' } }, null, 2));
  run(['compose', '--project', dir]);
  expect((await reviewer()).includes('- `uv run mypy .` for the affected packages'), 'vocabulary: a project that declares a name changes it');
  await writeFile(profilePath, JSON.stringify({ ...profile, vocabulary: { ...profile.vocabulary, TYPECHECK_CMD: null } }, null, 2));
  run(['compose', '--project', dir]);
  expect((await reviewer()).includes('{{TYPECHECK_CMD}}'), 'vocabulary: declaring one as null takes it over, and it stands until filled');
  expect(run(['check', '--project', dir], { loud: true }).out.includes('{{TYPECHECK_CMD}} is declared but not filled in'), 'vocabulary: and check says so, as compose leaves it');

  // A pinned project composes its release's defaults, never the working tree's — the release froze them.
  const nina = await scratch();
  await cp(join(ROOT, 'bin'), join(nina, 'bin'), { recursive: true });
  await cp(join(ROOT, 'src'), join(nina, 'src'), { recursive: true });
  await writeFile(join(nina, 'package.json'), `${JSON.stringify({ name: '@xhulz/nina', version: '0.0.0', type: 'module' }, null, 2)}\n`);
  await mkdir(join(nina, 'surfaces'), { recursive: true });
  await mkdir(join(nina, 'core', 'tree'), { recursive: true });
  await writeFile(join(nina, 'core', 'tree', 'CLAUDE.md'), '# Bed\n\nRun `{{TYPECHECK_CMD}}`.\n');
  await writeFile(join(nina, 'core', 'vocabulary.json'), JSON.stringify({ TYPECHECK_CMD: 'as-released typecheck' }));
  const log = console.log;
  console.log = () => {};
  await release(['1.0.0'], { root: nina });
  console.log = log;
  await writeFile(join(nina, 'core', 'vocabulary.json'), JSON.stringify({ TYPECHECK_CMD: 'working-tree typecheck' }));
  const composedWith = async (core) => {
    const bed = await scratch();
    await mkdir(join(bed, '.nina'), { recursive: true });
    await writeFile(join(bed, '.nina', 'profile.json'), JSON.stringify({ core, surfaces: [], vocabulary: {} }));
    spawnSync(process.execPath, [join(nina, 'bin', 'nina.mjs'), 'compose', '--project', bed, '--quiet'], { encoding: 'utf8' });
    return readFile(join(bed, 'CLAUDE.md'), 'utf8').catch(() => '');
  };
  expect((await composedWith('1.0.0')).includes('Run `as-released typecheck`.'), 'vocabulary: a project pinned to a release composes that release\'s default');
  expect((await composedWith('dev')).includes('Run `working-tree typecheck`.'), 'vocabulary: and one tracking the working tree composes the working tree\'s');

  // A project on a release before the defaults, looking at a move onto one: the defaulted names are not owed.
  const old = await scratch();
  run(['init', '--project', old, '--surfaces', 'frontend', '--core', '0.22.0']);
  const preview = run(['upgrade', '--project', old, '--to', 'dev'], { loud: true }).out;
  expect(!preview.includes('TYPECHECK_CMD'), `vocabulary: an upgrade onto a release with defaults does not ask for them — got ${preview}`);
}

// ─── cost: what a run spent, from its own transcript, priced when it is read ─────────────
{
  // A streamed message is written once per content block, under one id, with its output growing.
  const streamed = (id, output, extra = {}) => ({ id, usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, ...extra }, model: 'claude-sonnet-5' });
  const rows = [streamed('m1', 5), streamed('m1', 50), streamed('m1', 500), streamed('m2', 100, { cache_creation: { ephemeral_5m_input_tokens: 150, ephemeral_1h_input_tokens: 50 } })];
  const usage = new Map();
  for (const row of rows) usage.set(row.id, row);
  const { tokens, model } = tokensOf(usage);
  expect(tokens.output === 600 && tokens.input === 20 && tokens.read === 2000, `cost: each message counts once, at its final usage — got ${JSON.stringify(tokens)}`);
  expect(tokens.write_5m === 350 && tokens.write_1h === 50, `cost: a write is split by TTL where the transcript says, and is the 5-minute kind where it does not — got ${JSON.stringify(tokens)}`);
  expect(model === 'claude-sonnet-5', 'cost: the model is the one that spent the tokens');
  expect(tokensOf(new Map()).tokens === null, 'cost: a run with no usage has no token record, not a zero one');
  const fast = new Map([['f1', { usage: { output_tokens: 10, speed: 'fast' }, model: 'claude-opus-5' }]]);
  const fellBack = new Map([['f2', { usage: { output_tokens: 10, iterations: [{ type: 'fallback_message' }] }, model: 'claude-fable-5-1' }]]);
  expect(tokensOf(fast).model === null && tokensOf(fellBack).model === null, 'cost: a fast-mode or fallback run is left unpriced rather than priced as the model it names');

  expect(priceOf('claude-opus-5-5').input === 4 && priceOf('claude-opus-5').input === 5, 'cost: the longest model prefix wins — 5.5 is not priced as 5');
  expect(priceOf('claude-opus-4-8[1m]')?.input === 5, 'cost: a context suffix does not hide the model');
  expect(priceOf('opus') === null && costOf({ output: 1 }, 'opus') === null, 'cost: a model the table does not know is left out, not guessed');
  expect(Math.abs(costOf({ input: 1e6, output: 1e6, write_5m: 1e6, write_1h: 1e6, read: 1e6 }, 'claude-sonnet-5') - (2 + 10 + 2.5 + 4 + 0.2)) < 1e-9, 'cost: writes at 1.25× and 2× input, reads at 0.1×');
  expect(Math.abs(costOf({ read: 1e6 }, 'claude-fable-5-1') - 0.25) < 1e-9, "cost: a model's own read rate beats the 0.1× rule");

  // End to end: a dispatch, its launch naming the agent, and the agent's own transcript.
  const dir = await scratch();
  await writeFile(
    join(dir, 'session.jsonl'),
    [
      JSON.stringify({ type: 'assistant', uuid: 'd1', timestamp: '2026-09-24T10:00:00.000Z', sessionId: 's1', message: { content: [{ type: 'tool_use', id: 'toolu_c', name: 'Agent', input: { subagent_type: 'reviewer' } }] } }),
      JSON.stringify({ type: 'user', uuid: 'd2', timestamp: '2026-09-24T10:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_c', content: 'Async agent launched. agentId: abc123' }] } }),
      '',
    ].join('\n'),
  );
  await mkdir(join(dir, 's1', 'subagents'), { recursive: true });
  await writeFile(
    join(dir, 's1', 'subagents', 'agent-abc123.jsonl'),
    // Every streamed copy, as Claude Code writes them: the reader, not this test, has to keep the last.
    rows.map((u) => JSON.stringify({ type: 'assistant', message: { id: u.id, model: u.model, usage: u.usage, content: [] } })).concat(['']).join('\n'),
  );
  const agentFile = join(dir, 's1', 'subagents', 'agent-abc123.jsonl');
  // Three writes to two files, and a read that writes nothing.
  const tool = (name, input) => JSON.stringify({ type: 'assistant', message: { id: `w${Math.random()}`, content: [{ type: 'tool_use', name, input }] } });
  await writeFile(
    agentFile,
    `${await readFile(agentFile, 'utf8')}${[
      tool('Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' }),
      tool('Write', { file_path: '/p/b.ts', content: '' }),
      tool('MultiEdit', { file_path: '/p/a.ts', edits: [] }),
      tool('Read', { file_path: '/p/c.ts' }),
      JSON.stringify({ type: 'assistant', message: { id: 'h1', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'VERDICT: REJECTED\\nISSUES: a' } }] } }),
    ].join('\n')}\n`,
  );
  const [record] = (await scanProject(dir, {})).records;
  expect(record?.files_touched === 2, `proportion: a run counts the distinct files it wrote, not its edits or its reads — got ${record?.files_touched}`);
  expect(!JSON.stringify(record).includes('/p/a.ts'), 'proportion: and keeps the number, never the paths');
  expect(record?.tokens?.output === 600 && record.usage_model === 'claude-sonnet-5', `cost: the snapshot record carries the run's tokens and model — got ${JSON.stringify(record)}`);
  // A record read before it learned the field is read once more while its transcript is on disk —
  // how 825 runs recorded before tokens existed got theirs — and one already carrying it is not.
  const before = { ...record, agent_read: true, lessons_read: 0 };
  delete before.tokens;
  const [backfilled] = (await scanProject(dir, { cursors: {}, records: [before] })).records;
  expect(backfilled?.tokens?.output === 600, `cost: a record from before the field gets its tokens on the next snapshot — got ${JSON.stringify(backfilled?.tokens)}`);
  // Read in full and unchanged since: not read again. A sentinel survives the next scan only if it was skipped.
  const withoutFiles = { ...record };
  delete withoutFiles.files_touched;
  const [counted] = (await scanProject(dir, { cursors: {}, records: [withoutFiles] })).records;
  expect(counted?.files_touched === 2, `proportion: a record from before files were counted gets its count on the next snapshot — got ${counted?.files_touched}`);
  const [kept] = (await scanProject(dir, { cursors: {}, records: [{ ...record, tokens: { output: -1 } }] })).records;
  expect(kept?.tokens?.output === -1, 'cost: a run read in full whose transcript has not grown is not read again');
  // Resumed after it reported: the transcript grew, with more spend and a new verdict, and both are read.
  await writeFile(
    agentFile,
    `${await readFile(agentFile, 'utf8')}${[
      JSON.stringify({ type: 'assistant', message: { id: 'm3', model: 'claude-sonnet-5', usage: { input_tokens: 0, output_tokens: 400 }, content: [] } }),
      JSON.stringify({ type: 'assistant', message: { id: 'h2', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'VERDICT: APPROVED' } }] } }),
    ].join('\n')}\n`,
  );
  const [resumed] = (await scanProject(dir, { cursors: {}, records: [{ ...record }] })).records;
  expect(resumed?.tokens?.output === 1000 && resumed.verdict === 'APPROVED', `cost: a run resumed after it reported is read again — its later spend and its later verdict — got ${JSON.stringify({ tokens: resumed?.tokens, verdict: resumed?.verdict })}`);

  // stats prices them when it reads them.
  const snapshots = join(await scratch(), 'snaps');
  await mkdir(snapshots, { recursive: true });
  const row = (role, output, model = 'claude-sonnet-5') => JSON.stringify({ project: '-x', dispatch_id: `t${Math.random()}`, ts: '2026-09-24T10:00:00.000Z', role, verdict: 'APPROVED', verdict_source: 'declared', tokens: { input: 0, output, write_5m: 0, write_1h: 0, read: 0 }, usage_model: model });
  await writeFile(join(snapshots, '-x.jsonl'), `${[row('reviewer', 5e5), row('reviewer', 1.5e6), row('qa', 5e5), row('qa', 1e6, 'claude-opus-4-1')].join('\n')}\n`);
  const { out } = run(['stats', '--snapshots', snapshots, '--all'], { loud: true });
  // Two reviewer runs of $5 and $15: the median is the upper middle, as the duration column's is.
  expect(/reviewer\s+2\s+\$15\.00\s+\$20\.00\s+80%/.test(out) && /all stages\s+3\s+\$25\.00/.test(out), `cost: stats reports each stage's median, total and share — got ${out}`);
  expect(out.includes('4 of 4 runs have a token record, 1 on a model the price table does not know'), `cost: the header counts the runs it could not price — got ${out}`);
}

// ─── proportion: the size of a change against the chain it went through ──────────────────
{
  const snapshots = join(await scratch(), 'snaps');
  await mkdir(snapshots, { recursive: true });
  let clock = 0;
  const run_ = (session, role, verdict, files) =>
    JSON.stringify({ project: '-p', dispatch_id: `t${(clock += 1)}`, ts: `2026-09-24T10:${String(clock).padStart(2, '0')}:00.000Z`, session, role, verdict, verdict_source: 'declared', ...(files === undefined ? {} : { files_touched: files }) });
  const rows = [
    // A: a designed one-file change, closed by qa. B: two files, no design, its fix round kept in the cycle — sized 2, not 4.
    run_('s1', 'architect', 'SPEC-READY'), run_('s1', 'implementer', 'DIFF-READY', 1), run_('s1', 'reviewer', 'APPROVED'), run_('s1', 'qa', 'PASS'),
    run_('s1', 'implementer', 'DIFF-READY', 2), run_('s1', 'reviewer', 'REJECTED'), run_('s1', 'implementer', 'DIFF-READY', 2), run_('s1', 'qa', 'PASS'),
    // C: designed by a planner alone, closed by a deploy. D: three files after it, no design.
    run_('s2', 'planner', 'PLAN-READY'), run_('s2', 'implementer', 'DIFF-READY', 12), run_('s2', 'devops', 'DEPLOYED'),
    run_('s2', 'implementer', 'DIFF-READY', 3), run_('s2', 'qa', 'PASS'),
    // E: designed, closed by a clear audit. F: four files after it, still open when the record ends.
    run_('s3', 'architect', 'SPEC-READY'), run_('s3', 'implementer', 'DIFF-READY', 5), run_('s3', 'secops', 'SECURE'),
    run_('s3', 'implementer', 'DIFF-READY', 4),
    // G: a light chain with no qa, ended by the design that follows it. H: that design's twelve files.
    run_('s4', 'implementer', 'DIFF-READY', 2), run_('s4', 'reviewer', 'APPROVED'), run_('s4', 'architect', 'SPEC-READY'), run_('s4', 'implementer', 'DIFF-READY', 12), run_('s4', 'qa', 'PASS'),
    // I: closed by a qa whose verdict could not be read.
    run_('s5', 'implementer', 'DIFF-READY', 3), run_('s5', 'qa', 'UNCLEAR'),
    // J: one cycle — a rejection sent the work back to the architect, which the graph routes, so it is no new change.
    run_('s6', 'architect', 'SPEC-READY'), run_('s6', 'implementer', 'DIFF-READY', 3), run_('s6', 'reviewer', 'REJECTED'), run_('s6', 'architect', 'SPEC-READY'), run_('s6', 'implementer', 'DIFF-READY', 3), run_('s6', 'qa', 'PASS'),
  ];
  await writeFile(join(snapshots, '-p.jsonl'), `${rows.join('\n')}\n`);
  const { out } = run(['stats', '--snapshots', snapshots, '--all'], { loud: true });
  expect(
    out.includes('proportion — 10 cycle(s) that wrote code') && out.includes('1 closed by a run whose verdict could not be read') && out.includes('1 still open'),
    `proportion: cycles close at qa, a deploy, a clear audit, an unreadable closer or the next design, and the header says which were unreadable or open — got ${out}`,
  );
  expect(
    /1–2 files\s+3\s+1 \(33%\)/.test(out) && /3–9 files\s+5\s+2 \(40%\)/.test(out) && /10\+ files\s+2\s+2 \(100%\)/.test(out),
    `proportion: each cycle is sized by its largest write and marked by whether it was designed — got ${out}`,
  );
}

// ─── 0.21.1: a new project, an adopted one, and the declaration detector ─────────────────
{
  const installed = async (dir) => {
    await mkdir(join(dir, 'node_modules', '@xhulz'), { recursive: true });
    await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
    await symlink(ROOT, join(dir, 'node_modules', '@xhulz', 'nina'));
    await symlink(join(ROOT, 'bin', 'nina.mjs'), join(dir, 'node_modules', '.bin', 'nina'));
  };

  // An adopted project: a CLAUDE.md written by hand, and a symlink where an agent spec goes. init
  // composes nothing over either, says so, and loses nothing.
  const adopted = await scratch();
  await writeFile(join(adopted, 'package.json'), '{\n  "name": "adopted"\n}\n');
  await installed(adopted);
  await writeFile(join(adopted, 'CLAUDE.md'), '# ours, by hand\n');
  await writeFile(join(adopted, 'AGENTS.md'), '# the real reviewer\n');
  await mkdir(join(adopted, '.claude', 'agents'), { recursive: true });
  await symlink(join(adopted, 'AGENTS.md'), join(adopted, '.claude', 'agents', 'reviewer.md'));
  const adopting = run(['init', '--project', adopted, '--surfaces', '', '--no-ask'], { loud: true });
  expect(
    adopting.status === 0 && adopting.out.includes('composed:  nothing') && adopting.out.includes('CLAUDE.md') && adopting.out.includes('.claude/agents/reviewer.md'),
    `init: names the project's own files in the way instead of composing over them — got ${adopting.out}`,
  );
  expect(
    (await readFile(join(adopted, 'CLAUDE.md'), 'utf8')) === '# ours, by hand\n' && (await readFile(join(adopted, 'AGENTS.md'), 'utf8')) === '# the real reviewer\n',
    'init: and neither file, nor the one behind the link, is touched',
  );
  expect((await readFile(join(adopted, '.nina', 'TODO.md'), 'utf8')).includes('did NOT compose'), 'init: the TODO says it did not compose, and why');

  // A package hoisted to a workspace root is installed, as far as the scripts' import is concerned.
  const workspace = await scratch();
  await installed(workspace);
  const member = join(workspace, 'apps', 'member');
  await mkdir(member, { recursive: true });
  expect(packageInstalled(member), 'wiring: a package hoisted to the workspace root counts as installed');
  expect(!packageInstalled(await scratch()), 'wiring: and a project with none anywhere above it does not');

  // Hooks kept in settings.local.json run all the same, so they count.
  const local = await scratch();
  await mkdir(join(local, '.claude'), { recursive: true });
  await writeFile(join(local, '.claude', 'settings.local.json'), settingsFile(new Set(['scripts/loop-gate.mjs'])));
  expect(
    !(await missingWiring(local, new Set(['scripts/loop-gate.mjs']))).some((w) => w.includes(' has no ')),
    'wiring: hooks in .claude/settings.local.json count as wired',
  );

  // An old command, exactly as init or wire wrote it, is updated to say when its script cannot start;
  // a customised one is left alone.
  const stale = await scratch();
  await mkdir(join(stale, '.claude'), { recursive: true });
  await installed(stale);
  const old = JSON.parse(settingsFile());
  old.hooks.Stop[0].hooks[0].command = 'f="${CLAUDE_PROJECT_DIR:-.}/scripts/harness-check.mjs"; [ -f "$f" ] && node "$f" --hook || true';
  old.hooks.UserPromptSubmit[0].hooks[0].command = 'node scripts/harness-check.mjs --context # ours';
  await writeFile(join(stale, '.claude', 'settings.json'), JSON.stringify(old, null, 2));
  await mkdir(join(stale, '.nina'), { recursive: true });
  await writeFile(join(stale, '.nina', 'profile.json'), JSON.stringify({ core: 'dev', surfaces: [], vocabulary: {} }));
  await writeFile(join(stale, 'package.json'), JSON.stringify({ name: 's', scripts: { 'harness:check': 'node scripts/harness-check.mjs', 'harness:compose:check': 'nina compose --check --quiet' } }));
  const staleSeen = run(['wire', '--project', stale], { loud: true });
  expect(staleSeen.status === 1 && staleSeen.out.includes('before it could say its script did not start'), `wire: names a hook still on the old command — got ${staleSeen.out}`);
  run(['wire', '--project', stale, '--apply']);
  const updated = JSON.parse(await readFile(join(stale, '.claude', 'settings.json'), 'utf8'));
  expect(
    updated.hooks.Stop[0].hooks[0].command.includes('could not start') && updated.hooks.UserPromptSubmit[0].hooks[0].command === 'node scripts/harness-check.mjs --context # ours',
    'wire --apply: updates the old command it wrote, and never a customised one',
  );
  expect(run(['wire', '--project', stale]).status === 0, 'wire: and is current afterwards');

  // A sound bed: an agent of the project's own is not a stage the graph forgot, and a skill missing on
  // this machine is for `nina check` by hand, not for the detector that speaks before every prompt.
  const bed = await sound('plain', 'dev');
  await writeFile(join(bed, '.claude', 'agents', 'docs-writer.md'), '---\nname: docs-writer\ntools: Read\n---\nOurs.\n');
  const reviewerSpec = join(bed, '.claude', 'agents', 'reviewer.md');
  await writeFile(reviewerSpec, (await readFile(reviewerSpec, 'utf8')).replace('| Skill | Invoke when the diff touches… |\n|---|---|', '| Skill | Invoke when the diff touches… |\n|---|---|\n| `nina-absent-skill-xyz` | never |'));
  const byHand = run(['check', '--project', bed], { loud: true });
  const asDetector = run(['check', '--project', bed, '--detector'], { loud: true });
  expect(!byHand.out.includes('docs-writer'), `check: an agent of the project's own is not reported as a missing stage — got ${byHand.out}`);
  expect(byHand.out.includes('nina-absent-skill-xyz') && !asDetector.out.includes('nina-absent-skill-xyz') && asDetector.status === 0, `check --detector: leaves the machine's skills to a check run by hand — got ${asDetector.out}`);
}

// ─── upgrade: a core that adds the declaration detector does not blame the move for old problems ─
{
  // Measured before the move by an old harness-check that never ran `check`, the new detector read every
  // problem the project already had as one the move made — and rolled back, --force or not.
  const bed = await sound('plain', (await readdir(join(ROOT, 'releases'))).sort(byVersion).at(-1));
  await rm(join(bed, '.claude', 'architecture.md'));
  const moved = run(['upgrade', '--project', bed, '--to', 'dev', '--apply'], { loud: true });
  expect(
    moved.status === 0 && /applied and verified/.test(moved.out),
    `upgrade: a problem the project already had is not the move's, however many detectors can see it — got ${moved.status}\n${moved.out}`,
  );
}

for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length === 0 ? '  ✓ init, check, compose, where, upgrade, pills, stats\ncli: ok' : `\ncli: ${failures.length} failing`);
process.exit(failures.length === 0 ? 0 : 1);
