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
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { isLoopBack } from '../transcripts.mjs';
import { frontmatter, pillFiles } from './pills.mjs';
import { snapshotsDir } from '../paths.mjs';
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

  const all = await load(dir, { since, project });
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
  const harnessProjects = new Set(
    [...pipelineCount].filter(([, n]) => n >= MIN_PIPELINE_DISPATCHES).map(([p]) => p),
  );
  const includeAll = argv.includes('--all');
  const records = (includeAll ? all : all.filter((r) => harnessProjects.has(r.project))).sort((a, b) =>
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
      `    ${loopBacks} loop-back(s) in the window → ${inWindow} pill(s) written (${pct(inWindow, loopBacks)})` +
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
