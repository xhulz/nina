/**
 * `nina stats` — reports how the pipeline actually behaved, from the snapshots.
 *
 * This is the measurement the harness never had: loop-back rate per stage, so a gate
 * can be judged by whether it ever stops anything rather than by whether it is in the
 * table.
 *
 * It also reports the one rule that governs the harness's own improvement. The router
 * writes a pill on every loop-back, and nothing ever checked whether that happened — so
 * the rule ran at a fraction of its declared rate for months, invisibly, while the
 * loop-backs it was supposed to harvest were being counted right here.
 */

import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { isLoopBack } from '../transcripts.mjs';
import { frontmatter, pillFiles } from './pills.mjs';
import { HARNESS, snapshotsDir } from '../paths.mjs';
import { defaultVocabulary } from '../vocabulary.mjs';
import { layerRootFor } from './compose.mjs';
import { PRICES_AS_OF, costOf } from '../prices.mjs';

/**
 * The pipeline roles. A project that dispatches only generic agents
 * (`general-purpose`, `Explore`, `Plan`) is not running the harness, so it is left out
 * of the report by default — capture stays wide because losing a transcript is
 * irreversible, but measuring a pipeline against projects that have none is noise.
 */
/**
 * The roles whose job is to approve or reject.
 *
 * Only these can be judged by loop-back rate. A planner, architect or implementer produces
 * work rather than ruling on it, so its rate is near zero by nature and says nothing — the
 * first version of this check used a sample size instead of a role list and therefore asked
 * the question of everyone, which is why it had to be silenced by a single loop-back.
 */
const GATES = new Set(['reviewer', 'qa', 'dba', 'integration-tester', 'secops', 'devops']);

/** Below this rate a gate is worth a second look. The gates that do stop things sit near 20%. */
const GATE_FLOOR = 0.05;

/** Fewer readable verdicts than this and the rate is noise, whatever it says. */
const GATE_SAMPLE = 20;

const PIPELINE_ROLES = new Set([
  'planner',
  'architect',
  'implementer',
  'dba',
  'integration-tester',
  'reviewer',
  'qa',
  'secops',
  'devops',
]);

/**
 * Loads snapshot records, optionally filtered.
 *
 * @param {string} dir - Snapshot directory.
 * @param {{since: string|null, project: string|null}} opts - Filters.
 * @returns {Promise<object[]>} The matching records.
 */
async function load(dir, opts) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
  const out = [];
  for (const file of files) {
    if (opts.project && !file.includes(opts.project)) continue;
    const rl = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (opts.since && String(r.ts).slice(0, 10) < opts.since) continue;
        out.push(r);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}


/**
 * Turns a snapshot's encoded project name back into a directory.
 *
 * The encoding replaces every separator with a dash, so `Code-IA-harness` could be
 * `Code/IA/harness` or `Code/IA-harness` and the string alone cannot say which. The
 * filesystem can, so the split is resolved against it rather than guessed.
 *
 * @param {string} encoded - The `project` field of a snapshot record.
 * @returns {string | null} The directory, or `null` when no split of the name exists.
 */
export function decodeProjectDir(encoded) {
  const parts = encoded.replace(/^-/, '').split('-');
  const walk = (base, i) => {
    if (i === parts.length) return base;
    for (let take = 1; take <= parts.length - i; take += 1) {
      const candidate = join(base, parts.slice(i, i + take).join('-'));
      if (!existsSync(candidate)) continue;
      const found = walk(candidate, i + take);
      if (found) return found;
    }
    return null;
  };
  return walk('/', 0);
}

/**
 * The name a project goes by outside this machine: its directory's, not the flattened path, which carries
 * the owner's home directory. A directory that is gone cannot be split back into its parts, so the name is
 * the path below home, flattened as it was.
 *
 * @param {string} encoded - A snapshot's project name.
 * @returns {string}
 */
export function projectName(encoded) {
  const decoded = decodeProjectDir(encoded);
  const home = `${homedir().replace(/[^A-Za-z0-9]/g, '-')}-`;
  return decoded ? basename(decoded) : encoded.startsWith(home) ? encoded.slice(home.length) : encoded.replace(/^-+/, '');
}

/**
 * Counts what the pipeline learned, against what it had to learn from.
 *
 * @param {string[]} projects - The encoded project names in the report.
 * @returns {Promise<{total:number, retired:number, undated:number, dates:string[], unresolved:string[]}>}
 */
export async function harvest(projects) {
  const out = { total: 0, retired: 0, undated: 0, dates: [], unresolved: [] };
  for (const name of projects) {
    const dir = decodeProjectDir(name);
    if (!dir) {
      out.unresolved.push(name);
      continue;
    }
    const pillsDir = join(dir, '.claude', 'pills');
    if (!existsSync(pillsDir)) continue;
    for (const pill of await pillFiles(pillsDir)) {
      out.total += 1;
      const fields = frontmatter(await readFile(pill.path, 'utf8'));
      if (fields?.status === 'retired') out.retired += 1;
      if (fields?.date) out.dates.push(fields.date);
      else out.undated += 1;
    }
  }
  out.dates.sort();
  return out;
}

/** Formats a percentage, or a dash when there is nothing to divide by. */
const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

/**
 * What each stage cost, at API list prices, over the runs whose tokens were recorded. A gate that
 * rarely sends work back is a question of what it costs as much as of what it catches, and until the
 * snapshot kept tokens only the second half could be asked.
 *
 * @param {object[]} records - The runs in the window.
 */
function costReport(records) {
  const measured = records.filter((r) => r.tokens && typeof r.tokens === 'object');
  if (measured.length === 0) return;
  /** @type {Map<string, number[]>} */
  const byRole = new Map();
  let unpriced = 0;
  for (const r of measured) {
    const cost = costOf(r.tokens, r.usage_model);
    if (cost === null) {
      unpriced += 1;
      continue;
    }
    byRole.set(r.role, [...(byRole.get(r.role) ?? []), cost]);
  }
  const total = [...byRole.values()].flat().reduce((a, b) => a + b, 0);
  if (total === 0) return;
  const money = (n) => `$${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`;
  // The same convention as the duration column beside it: the upper middle of an even count.
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(
    `\n  cost — at API list prices of ${PRICES_AS_OF}; ${measured.length} of ${records.length} runs have a token record` +
      (unpriced > 0 ? `, ${unpriced} on a model the price table does not know` : ''),
  );
  console.log(`    ${'stage'.padEnd(20)}${'runs'.padStart(6)}${'median'.padStart(10)}${'total'.padStart(10)}${'share'.padStart(8)}`);
  for (const [role, costs] of [...byRole].sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0))) {
    const sum = costs.reduce((a, b) => a + b, 0);
    console.log(
      `    ${role.padEnd(20)}${String(costs.length).padStart(6)}${money(median(costs)).padStart(10)}` +
        `${money(sum).padStart(10)}${pct(sum, total).padStart(8)}`,
    );
  }
  console.log(`    ${'all stages'.padEnd(20)}${String([...byRole.values()].flat().length).padStart(6)}${''.padStart(10)}${money(total).padStart(10)}`);
}

/**
 * Whether a model a run used is the one a spec declares: an alias (`opus`) names a family — a whole
 * segment of the id, wherever it sits, so `claude-3-sonnet` is a sonnet — anything else names a model
 * outright, and `inherit` runs on whatever the session does, so it declares nothing.
 *
 * @param {string} declared - A spec's `model:` value.
 * @param {string} used - The model the run's messages came from.
 * @returns {boolean|null} Null when the spec declares nothing to compare with.
 */
export function modelMatches(declared, used) {
  const want = String(declared ?? '').toLowerCase();
  if (!want || want === 'inherit') return null;
  const model = used.toLowerCase();
  return /^[a-z]+$/.test(want) ? model.replace(/\[.*$/, '').split('-').includes(want) : model.startsWith(want);
}

/**
 * When a spec's `model:` line last changed. The file's own time will not do: `compose` rewrites every
 * composed file, and an upgrade changes specs whose model it leaves alone, so either would move the
 * date and drop the runs before it from the comparison. The project's history says when that one line
 * last changed; the file's time stands in only where the history cannot say — no repository, a file
 * it does not track, or a model line changed and not yet committed.
 *
 * @param {string} dir - The project.
 * @param {string} rel - The spec, relative to it.
 * @param {string} declared - The model the spec declares now.
 * @returns {number} Milliseconds since the epoch.
 */
function declaredSince(dir, rel, declared) {
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const committed = frontmatter(git('show', `HEAD:./${rel}`).stdout ?? '')?.model;
  const when = Date.parse(git('log', '-1', '--format=%cI', '-G', '^model:', '--', rel).stdout?.trim() ?? '');
  return committed === declared && Number.isFinite(when) ? when : statSync(join(dir, rel)).mtimeMs;
}

/**
 * What each stage ran on. A spec's `model:` is the one choice here that changes cost by an order of
 * magnitude, and it had only ever been read, never measured: the model a run used is on every record,
 * so a stage that ran on more than one can be read model by model — its runs, when, how often it sent
 * work back, and what a run cost. The effort level is read with it, where the record has one. That is a comparison across different weeks of different work, not
 * an experiment; what it can settle is whether a change is worth an eval.
 *
 * Where a project's directory can be found it also asks whether each stage runs on the model its spec
 * declares, counting only the runs made after the spec was last written — a spec changed today says
 * nothing about yesterday's runs. A difference there is an override: a model on the dispatch, or one
 * set for every subagent in the environment, which no spec shows.
 *
 * @param {object[]} records - The runs in the window.
 */
function modelReport(records) {
  const ran = records.filter((r) => typeof r.usage_model === 'string' && r.usage_model);
  /** @type {Map<string, Map<string, object[]>>} */
  const byRole = new Map();
  for (const r of ran) {
    if (!PIPELINE_ROLES.has(r.role)) continue;
    const models = byRole.get(r.role) ?? new Map();
    // The effort is part of what a stage ran on: one model at two levels wrote seven times as much.
    const on = r.effort ? `${r.usage_model} · ${r.effort}` : r.usage_model;
    models.set(on, [...(models.get(on) ?? []), r]);
    byRole.set(r.role, models);
  }
  const changed = [...byRole].filter(([, models]) => models.size > 1).sort(([a], [b]) => a.localeCompare(b));

  const money = (n) => `$${n.toFixed(2)}`;
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const lines = [];
  for (const [role, models] of changed) {
    const ordered = [...models].sort(([, a], [, b]) => String(a[0].ts).localeCompare(String(b[0].ts)));
    for (const [i, [model, runs]] of ordered.entries()) {
      const clear = runs.filter((r) => r.verdict && r.verdict !== 'UNCLEAR' && r.verdict !== 'NONE');
      const loops = clear.filter((r) => isLoopBack(r.verdict)).length;
      const costs = runs.map((r) => (r.tokens ? costOf(r.tokens, r.usage_model) : null)).filter((c) => c !== null);
      const dates = runs.map((r) => String(r.ts).slice(0, 10)).sort();
      lines.push(
        `    ${(i === 0 ? role : '').padEnd(20)}${model.padEnd(26)}${String(runs.length).padStart(5)} run(s)  ${dates[0]} → ${dates.at(-1)}` +
          (clear.length ? `  loop-back ${pct(loops, clear.length)} of ${clear.length}` : '  no readable verdict') +
          (costs.length ? `  median ${money(median(costs))}` : ''),
      );
    }
  }

  // Declared against used, per project and stage, over the runs since the spec's model last changed.
  // Every spec the project has is asked, its own agents included: they declare a model too.
  const drift = [];
  const byProject = new Map();
  for (const r of ran) byProject.set(r.project, [...(byProject.get(r.project) ?? []), r]);
  for (const [project, runs] of byProject) {
    const dir = decodeProjectDir(project);
    if (!dir) continue;
    for (const role of new Set(runs.map((r) => r.role))) {
      const rel = join('.claude', 'agents', `${role}.md`);
      if (!existsSync(join(dir, rel))) continue;
      const declared = frontmatter(readFileSync(join(dir, rel), 'utf8'))?.model;
      if (modelMatches(declared, '') === null) continue;
      const written = declaredSince(dir, rel, declared);
      const since = runs.filter((r) => r.role === role && Date.parse(r.ts) > written);
      const other = since.filter((r) => modelMatches(declared, r.usage_model) === false);
      if (other.length === 0) continue;
      const used = [...new Set(other.map((r) => r.usage_model))].join(', ');
      drift.push(
        `    ${basename(dir)}: ${role} declares ${declared}, and ${other.length} of ${since.length} run(s) since that line last changed ran ${used} — an override no spec shows`,
      );
    }
  }

  if (lines.length === 0 && drift.length === 0) return;
  console.log('\n  models — a stage that ran on more than one model or effort level, one line each; different weeks, not an experiment');
  for (const line of lines) console.log(line);
  for (const line of drift) console.log(line);
}

/** The verdicts that close a pipeline cycle: the change passed its tests, reached preview, or cleared the audit. */
const CYCLE_ENDS = { qa: 'PASS', devops: 'DEPLOYED', secops: 'SECURE' };

/** The stages that write code, whose runs' file counts size a cycle. */
const WRITERS = new Set(['implementer', 'solidity-dev']);

/** The stages whose presence makes a cycle a designed one. */
const DESIGNERS = new Set(['planner', 'architect']);

/**
 * How the size of a change sat against the weight of the chain it went through: the core's first hard
 * rule, which nothing had measured. A cycle is a session's dispatches up to the verdict that closes one
 * (`CYCLE_ENDS`), so a loop-back's fix rounds stay with the design that preceded them — the owner's own
 * prompts were tried as the boundary first, and every "pode seguir" after a spec cut a pipeline in two.
 * Two more things end a cycle, both found in real sessions: a design stage dispatched after code was
 * written starts the next change — the light chain has no qa to close it, and it was absorbed into the
 * design that followed — unless the verdict before it sent work back, which the graph routes into both
 * designers; and a closing stage whose verdict cannot be read still closes it, counted as unreadable,
 * because a qa run with no verdict line otherwise let one cycle swallow a dozen pipelines. A cycle is
 * sized by the most files any one of its writers wrote, not their sum, so three fix rounds on two files
 * stay two files; and only edits through the edit tools count, so a file written from a shell is missed
 * and the size is a floor.
 *
 * It reports a distribution, not verdicts. A critical path is gated in full at any size and cannot be
 * seen from a file count, and one spec legitimately covers sibling steps (`ONE-SPEC`), so a cycle with
 * no architect of its own is not by itself a skipped gate. What the table can show is the shape: how
 * often a design stage ran for a change of one or two files, and how the large changes were carried.
 *
 * @param {object[]} records - The runs in the window.
 */
function proportionReport(records, stepLimit = () => null) {
  const measured = records.filter((r) => WRITERS.has(r.role) && typeof r.files_touched === 'number');
  if (measured.length === 0) return;
  /** @type {Map<string, object[]>} */
  const bySession = new Map();
  for (const r of [...records].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) {
    const key = `${r.project ?? ''}|${r.session ?? ''}`;
    bySession.set(key, [...(bySession.get(key) ?? []), r]);
  }
  /** @type {{runs: object[], end: 'closed'|'unreadable'|'next'|'open'}[]} */
  const cycles = [];
  const unread = (verdict) => !verdict || verdict === 'UNCLEAR' || verdict === 'NONE';
  for (const runs of bySession.values()) {
    let cycle = [];
    let previous = null;
    const end = (how) => {
      if (cycle.length > 0) cycles.push({ runs: cycle, end: how });
      cycle = [];
    };
    for (const r of runs) {
      if (DESIGNERS.has(r.role) && cycle.some((x) => WRITERS.has(x.role)) && !isLoopBack(previous)) end('next');
      cycle.push(r);
      if (r.role in CYCLE_ENDS) {
        if (r.verdict === CYCLE_ENDS[r.role]) end('closed');
        else if (unread(r.verdict)) end('unreadable');
      }
      if (!unread(r.verdict)) previous = r.verdict;
    }
    end('open');
  }
  const rows = [
    { label: '1–2 files', from: 1, to: 2 },
    { label: '3–9 files', from: 3, to: 9 },
    { label: '10+ files', from: 10, to: Infinity },
  ].map((b) => ({ ...b, cycles: 0, designed: 0 }));
  let built = 0;
  let unreadable = 0;
  let open = 0;
  for (const { runs: cycle, end } of cycles) {
    const sizes = cycle.filter((r) => WRITERS.has(r.role) && typeof r.files_touched === 'number').map((r) => r.files_touched);
    if (sizes.length === 0) continue;
    const files = Math.max(...sizes);
    const row = rows.find((b) => files >= b.from && files <= b.to);
    if (!row) continue;
    built += 1;
    if (end === 'unreadable') unreadable += 1;
    if (end === 'open') open += 1;
    row.cycles += 1;
    if (cycle.some((r) => DESIGNERS.has(r.role))) row.designed += 1;
  }
  if (built === 0) return;
  console.log(
    `\n  proportion — ${built} cycle(s) that wrote code; a cycle closes at qa PASS, devops DEPLOYED or secops SECURE, or at the next design after code` +
      (unreadable > 0 ? `; ${unreadable} closed by a run whose verdict could not be read` : '') +
      (open > 0 ? `; ${open} still open when their session's record ends` : ''),
  );
  console.log(`    ${'largest write'.padEnd(16)}${'cycles'.padStart(8)}${'with a planner or architect'.padStart(30)}`);
  for (const row of rows) {
    console.log(`    ${row.label.padEnd(16)}${String(row.cycles).padStart(8)}${`${row.designed} (${pct(row.designed, row.cycles)})`.padStart(30)}`);
  }
  console.log('    A shape, not a verdict: a critical path is gated in full at any size, and one spec may cover sibling steps.');

  // The one size the harness does limit: what one implementer run writes. A run re-reads the context it
  // has built on every turn, so its cost grows faster than its size — measured over two projects, the
  // cache read per file held near 1M up to 19 files and was 6.9M in a 52-file run. Asked only of a project
  // whose pinned release states the limit.
  const over = records.filter((r) => {
    if (r.role !== 'implementer' || typeof r.files_touched !== 'number') return false;
    const limit = stepLimit(r.project);
    return limit !== null && r.files_touched > limit;
  });
  if (over.length > 0) {
    const largest = over.reduce((a, b) => (b.files_touched > a.files_touched ? b : a));
    const read = typeof largest.tokens?.read === 'number' ? `, ${Math.round(largest.tokens.read / 1e6)}M tokens read from cache` : '';
    console.log(
      `    ${over.length} implementer run(s) wrote more files than one step may (${stepLimit(largest.project)}); the largest wrote ${largest.files_touched}${read}. The architect splits such a spec into steps.`,
    );
  }
}

/**
 * The most files one implementer run may write in each measured project, as its pinned release states it
 * (`{{STEP_FILES}}`, which the project may declare to change), or null where the release has no such
 * limit or the project cannot be found.
 *
 * @param {{root: string}} ctx - CLI context, for the releases.
 * @returns {(project: string) => number|null}
 */
function stepLimitOf(ctx) {
  const known = new Map();
  return (project) => {
    if (!known.has(project)) {
      let limit = null;
      try {
        const found = decodeProjectDir(project);
        const profile = found ? JSON.parse(readFileSync(join(found, HARNESS, 'profile.json'), 'utf8')) : null;
        const layers = profile ? layerRootFor(ctx.root, profile.core) : null;
        const value = profile?.vocabulary?.STEP_FILES ?? (layers?.dir ? defaultVocabulary(layers.dir).STEP_FILES : undefined);
        const n = Number(value);
        limit = value !== undefined && value !== null && value !== '' && Number.isFinite(n) && n > 0 ? n : null;
      } catch {
        limit = null;
      }
      known.set(project, limit);
    }
    return known.get(project);
  };
}

/** Formats a median duration in minutes from a list of seconds. */
function medianMin(values) {
  const xs = values.filter((v) => typeof v === 'number' && v >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return '—';
  return `${(xs[Math.floor(xs.length / 2)] / 60).toFixed(1)}m`;
}

/**
 * Runs the stats report.
 *
 * @param {string[]} argv - Command arguments.
 * @param {{root: string}} ctx - CLI context.
 * @returns {Promise<number>} Process exit code.
 */
export async function stats(argv, ctx) {
  const dir = argv.includes('--snapshots') ? argv[argv.indexOf('--snapshots') + 1] : snapshotsDir();
  const since = argv.includes('--since') ? argv[argv.indexOf('--since') + 1] : null;
  const project = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : null;
  const includeAll = argv.includes('--all');
  // Run inside a project, the report is that project's: the store holds every project on the machine,
  // and a new project's owner who asked in its directory read six weeks of another project's history as
  // its own. `--project` names another, and `--all` asks for every one.
  // Matched by the directory a record's name decodes to, not by the name: a path reached through a
  // symlink flattens to another name.
  const here = !project && !includeAll && existsSync(join(process.cwd(), HARNESS, 'profile.json')) ? realpathSync(process.cwd()) : null;
  const sameDir = new Map();
  const isHere = (p) => {
    if (!sameDir.has(p)) {
      const found = decodeProjectDir(p);
      let same = p === here.replace(/[^A-Za-z0-9]/g, '-');
      try {
        same ||= found !== null && realpathSync(found) === here;
      } catch {
        // A directory that is gone is not this one.
      }
      sameDir.set(p, same);
    }
    return sameDir.get(p);
  };

  const loaded = await load(dir, { since, project });
  const all = here ? loaded.filter((r) => isHere(r.project)) : loaded;
  if (here && all.length === 0) {
    console.error(`no dispatch recorded for this project yet — \`nina stats --all\` reports every project`);
    return 1;
  }
  if (all.length === 0) {
    console.error('no snapshot data — run `nina snapshot` first');
    return 1;
  }

  /** A stray `planner` call in a one-off session does not make a project a harness project. */
  const MIN_PIPELINE_DISPATCHES = 10;
  const pipelineCount = new Map();
  for (const r of all) {
    if (!PIPELINE_ROLES.has(r.role)) continue;
    pipelineCount.set(r.project, (pipelineCount.get(r.project) ?? 0) + 1);
  }
  // A project that declares a profile runs the harness however few dispatches it has made: counted by
  // dispatches alone, a new project with five was hidden as not running it.
  const declares = (p) => {
    const found = decodeProjectDir(p);
    return Boolean(found && existsSync(join(found, HARNESS, 'profile.json')));
  };
  const harnessProjects = new Set(
    [...new Set(all.map((r) => r.project))].filter((p) => (pipelineCount.get(p) ?? 0) >= MIN_PIPELINE_DISPATCHES || declares(p)),
  );
  const records = (includeAll || here ? all : all.filter((r) => harnessProjects.has(r.project))).sort((a, b) =>
    String(a.ts).localeCompare(String(b.ts)),
  );

  if (records.length === 0) {
    console.error('no project in the snapshots runs the harness pipeline — use --all to report anyway');
    return 1;
  }

  const skipped = new Set(all.map((r) => r.project)).size - new Set(records.map((r) => r.project)).size;

  /**
   * @type {Map<string, {n:number, done:number, clear:number, loop:number, unclear:number,
   *   declared:number, durations:number[]}>}
   */
  const byRole = new Map();
  // A dispatch a hook denied never ran, so it is neither a run nor a missing verdict.
  const held = records.filter((r) => r.status === 'denied').length;
  for (const r of records.filter((r) => r.status !== 'denied')) {
    if (!byRole.has(r.role)) {
      byRole.set(r.role, { n: 0, done: 0, clear: 0, loop: 0, unclear: 0, declared: 0, durations: [] });
    }
    const s = byRole.get(r.role);
    s.n += 1;
    if (r.verdict) s.done += 1;
    if (r.verdict_source === 'declared' || r.verdict_source === 'handback') s.declared += 1;
    if (r.verdict === 'UNCLEAR' || r.verdict === 'NONE') s.unclear += 1;
    else if (r.verdict) {
      s.clear += 1;
      if (isLoopBack(r.verdict)) s.loop += 1;
    }
    if (typeof r.duration_s === 'number') s.durations.push(r.duration_s);
  }

  const span = [records[0]?.ts, records.at(-1)?.ts].map((t) => String(t).slice(0, 10));
  const projectCount = new Set(records.map((r) => r.project)).size;
  console.log(
    `  ${records.length} dispatches · ${projectCount} project${projectCount === 1 ? '' : 's'} · ` +
      `${span[0]} → ${span[1]}` +
      (here ? '  (this project; --all for every project)' : '') +
      (skipped > 0 ? `  (${skipped} non-harness project${skipped === 1 ? '' : 's'} hidden, --all to include)` : '') +
      (held > 0 ? `  · ${held} dispatch(es) denied by a hook, not counted as runs` : '') +
      '\n',
  );
  console.log(
    `  ${'stage'.padEnd(20)}${'runs'.padStart(6)}${'verdict'.padStart(9)}${'loop-back'.padStart(11)}` +
      `${'rate'.padStart(7)}${'declared'.padStart(10)}${'unreadable'.padStart(12)}` +
      `${'median'.padStart(9)}`,
  );

  const rows = [...byRole.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [role, s] of rows) {
    console.log(
      `  ${role.padEnd(20)}${String(s.n).padStart(6)}${String(s.clear).padStart(9)}` +
        `${String(s.loop).padStart(11)}${pct(s.loop, s.clear).padStart(7)}` +
        `${pct(s.declared, s.done).padStart(10)}${pct(s.unclear, s.done).padStart(12)}` +
        `${medianMin(s.durations).padStart(9)}`,
    );
  }

  const unreadable = rows.reduce((a, [, s]) => a + s.unclear, 0);
  const done = rows.reduce((a, [, s]) => a + s.done, 0);
  console.log(
    `\n  ${pct(unreadable, done)} of finished runs report no machine-readable verdict.` +
      ' Those stages need a verdict token on the report\'s first line.',
  );

  // Whether the stages that send work back say what they send back. Counted only over reports read
  // since the record learned the field, and only over declared loop-backs, which are all it asks of.
  const named = records.filter((r) => typeof r.issues === 'number');
  if (named.length > 0) {
    const withIds = named.filter((r) => r.issues > 0).length;
    console.log(
      `  ${withIds} of ${named.length} declared loop-back(s) (${pct(withIds, named.length)}) named their issues` +
        ' on the `ISSUES` line under the verdict.',
    );
  }

  const withSkills = records.filter((r) => r.agent_id && r.skills?.length > 0);
  // Only a run whose own transcript could be located says anything about skill use.
  const observable = records.filter((r) => r.agent_id).length;
  if (observable > 0) {
    const tally = new Map();
    for (const r of withSkills) for (const k of r.skills) tally.set(k, (tally.get(k) ?? 0) + 1);
    const list = [...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`);
    console.log(
      `  ${withSkills.length} of ${observable} runs with a readable transcript` +
        ` (${pct(withSkills.length, observable)}) invoked a Skill` +
        (list.length > 0 ? ` — ${list.join(', ')}` : ' — none at all'),
    );
  }

  // A gate that never stops anything is either upstream quality or a rubber stamp, and the
  // rate alone cannot say which — but it can say which gate to go and look at.
  const gates = rows.filter(([role]) => GATES.has(role));
  for (const [role, s] of gates) {
    if (s.clear < GATE_SAMPLE || s.loop / s.clear >= GATE_FLOOR) continue;
    const others = gates.filter(([other]) => other !== role);
    const elsewhere = pct(
      others.reduce((a, [, o]) => a + o.loop, 0),
      others.reduce((a, [, o]) => a + o.clear, 0),
    );
    console.log(
      `  ${role}: ${s.loop} loop-back(s) in ${s.clear} readable verdict(s) (${pct(s.loop, s.clear)}),` +
        ` against ${elsewhere} across the other gates — check whether it still gates anything.` +
        (s.n - s.clear > 0
          ? ` ${s.n - s.clear} further run(s) produced no readable verdict at all, so the rate may understate it.`
          : '') +
        // A rate built from verdicts a parser guessed at is not the same claim as one built
        // from verdicts the stage declared, and the difference decides whether it can be acted on.
        (s.declared < s.clear
          ? ` Only ${s.declared} of the ${s.clear} were declared by the stage; the rest were inferred from its report.`
          : ''),
    );
  }

  costReport(records.filter((r) => r.status !== 'denied'));
  modelReport(records.filter((r) => r.status !== 'denied'));
  proportionReport(records.filter((r) => r.status !== 'denied'), stepLimitOf(ctx));

  // What the pipeline learned, against what it had to learn from. A loop-back is the raw
  // material and a pill is the product, so the two numbers belong on the same screen: the
  // rule that turns one into the other is the only rule here that nothing else can check.
  const loopBacks = rows.reduce((a, [, s]) => a + s.loop, 0);
  const pills = await harvest([...new Set(records.map((r) => r.project))]);
  const newest = pills.dates.at(-1);
  const inWindow = pills.dates.filter((d) => d >= span[0] && d <= span[1]).length;

  console.log('\n  learning');
  if (pills.total === 0) {
    console.log(
      `    ${loopBacks} loop-back(s) and not one pill — either nothing was learned, or nothing was written down.`,
    );
  } else {
    console.log(
      // A share over 100% says nothing: the pills were written for something other than these loop-backs.
      `    ${loopBacks} loop-back(s) in the window → ${inWindow} pill(s) written${inWindow <= loopBacks ? ` (${pct(inWindow, loopBacks)})` : ''}` +
        ' — every loop-back is looked at for a lesson; `nina learn` shows which roles are owed one.' +
        (pills.undated > 0 ? ` ${pills.undated} pill(s) carry no date and cannot be placed.` : ''),
    );
    console.log(
      pills.retired === 0
        ? `    0 of ${pills.total} pill(s) retired — no correction has ever graduated into a rule.`
        : `    ${pills.retired} of ${pills.total} pill(s) retired into a rule.`,
    );
    if (newest) {
      const since = records.filter((r) => String(r.ts).slice(0, 10) > newest).length;
      if (since > 0) console.log(`    ${since} dispatch(es) since the newest pill (${newest}).`);
    }
  }
  for (const name of pills.unresolved) {
    console.log(`    ${name} could not be located on disk, so its pills are not counted.`);
  }
  return 0;
}
