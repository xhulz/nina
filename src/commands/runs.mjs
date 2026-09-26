/**
 * `nina runs` — what each piece of work cost: the pipeline's cycles in one project, newest first, each with
 * the stages it went through, their rounds, what was sent back, how long it took and what it cost.
 *
 * `stats` answers per stage and over a window, which is the right question for a gate and the wrong one for
 * the owner, whose question is what a feature, a spike or a fix came to. A cycle is the unit `stats` already
 * sizes (`cyclesOf`): a session's rounds up to the verdict that closes one. It is named by the description
 * the orchestrator gave its first dispatch, which is the one name the record keeps.
 *
 *   nina runs [--project <dir>] [--last N] [--since YYYY-MM-DD]
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HARNESS } from '../paths.mjs';
import { costOf } from '../prices.mjs';
import { isLoopBack, runOf } from '../transcripts.mjs';
import { amber, bold, dim, pink } from '../look.mjs';
import { storedRecords } from './snapshot.mjs';
import { cyclesOf, projectName } from './stats.mjs';

/** What ended a cycle, in words. */
const ENDS = {
  closed: (last) => `ended at ${last.role} ${last.verdict}`,
  unreadable: (last) => `ended at a ${last.role} whose verdict could not be read`,
  next: () => 'ended where the next design began',
  open: () => 'still open where the record ends',
};

/**
 * One cycle, summed: when, how long, what it cost, and each stage's rounds and loop-backs in the order the
 * stages first ran.
 *
 * @param {{runs: object[], end: string}} cycle
 * @returns {{start: string, end: string, minutes: number|null, cost: number, unpriced: number, name: string, how: string, stages: {role: string, runs: number, rounds: number, back: number}[], files: number|null}}
 */
export function summarize(cycle) {
  const rounds = cycle.runs;
  const start = rounds.map((r) => String(r.ts)).sort()[0];
  const end = rounds.map((r) => String(r.result_ts ?? r.ts)).sort().at(-1);
  const minutes = Number.isFinite(Date.parse(end) - Date.parse(start)) ? Math.round((Date.parse(end) - Date.parse(start)) / 60_000) : null;
  let cost = 0;
  let unpriced = 0;
  for (const r of rounds) {
    if (!r.tokens || typeof r.tokens !== 'object') continue;
    const c = costOf(r.tokens, r.usage_model);
    if (c === null) unpriced += 1;
    else cost += c;
  }
  const stages = new Map();
  for (const r of rounds) {
    const s = stages.get(r.role) ?? { role: r.role, runs: new Set(), rounds: 0, back: 0 };
    s.runs.add(runOf(r));
    s.rounds += 1;
    if (isLoopBack(r.verdict)) s.back += 1;
    stages.set(r.role, s);
  }
  const files = rounds.filter((r) => typeof r.files_touched === 'number').map((r) => r.files_touched);
  return {
    start,
    end,
    minutes,
    cost,
    unpriced,
    name: String(rounds[0]?.desc ?? '').trim() || '(no description)',
    how: ENDS[cycle.end](rounds.at(-1)),
    stages: [...stages.values()].map((s) => ({ ...s, runs: s.runs.size })),
    files: files.length ? Math.max(...files) : null,
  };
}

/** A duration in minutes, as hours and minutes. */
const span = (m) => (m === null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`);

/** A cost in dollars. */
const money = (n) => `$${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`;

/**
 * Runs the command.
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runs(argv) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const dir = resolve(arg('--project') ?? '.');
  if (!existsSync(join(dir, HARNESS, 'profile.json'))) {
    console.error(`  no ${HARNESS}/profile.json under ${dir} — run it inside a project, or name one with --project\n`);
    return 1;
  }
  const since = arg('--since');
  const last = Math.max(1, Number(arg('--last') ?? 10) || 10);
  const records = (storedRecords(dir) ?? []).filter((r) => r.status !== 'denied' && (!since || String(r.ts).slice(0, 10) >= since));
  if (records.length === 0) {
    console.error('  no measured history for this project yet — `nina snapshot` captures it\n');
    return 1;
  }
  const cycles = cyclesOf(records)
    .map(summarize)
    .sort((a, b) => b.start.localeCompare(a.start));
  const shown = cycles.slice(0, last);
  console.log(
    `  ${bold(pink(projectName(records[0].project)))} · ${cycles.length} cycle(s)` +
      dim(`  newest first${cycles.length > shown.length ? `, the last ${shown.length} — --last N for more` : ''}; a cycle runs up to the verdict that closes it`),
  );
  for (const c of shown) {
    const when = `${c.start.slice(0, 10)} ${c.start.slice(11, 16)}`;
    console.log(`\n  ${pink('▌')} ${bold(when)} · ${span(c.minutes)} · ${bold(money(c.cost))}${c.unpriced ? dim(` + ${c.unpriced} unpriced`) : ''} · ${dim(c.how)}`);
    console.log(`    ${c.name.length > 96 ? `${c.name.slice(0, 95)}…` : c.name}`);
    const chain = c.stages.map((s) => {
      const count = s.rounds > s.runs ? `${s.rounds} rounds` : `${s.rounds}`;
      return `${pink(s.role)} ${count}${s.back ? amber(`, ${s.back} sent back`) : ''}`;
    });
    console.log(`    ${chain.join(dim(' · '))}${c.files === null ? '' : dim(` · largest write ${c.files} file(s)`)}`);
  }
  const total = shown.reduce((a, c) => a + c.cost, 0);
  const costliest = shown.reduce((a, c) => (c.cost > a.cost ? c : a), shown[0]);
  console.log(
    `\n  ${shown.length} cycle(s): ${bold(money(total))} in all` +
      (shown.length > 1 ? `; the costliest, ${money(costliest.cost)}, ${costliest.start.slice(0, 10)} — ${costliest.name.slice(0, 60)}` : '') +
      '\n',
  );
  return 0;
}
