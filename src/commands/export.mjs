/**
 * `nina export --langfuse` — the measured history, sent to Langfuse.
 *
 *   nina export --langfuse [--project <name>] [--dry-run]
 *   nina export --langfuse --auto --project <slug>      what the `lessons` detector starts after a turn
 *
 * A project that is on (`nina langfuse on`) needs neither: the `lessons` detector every composed project
 * runs snapshots it each turn and starts `--auto` in the background when a run is ready to go. By hand, it
 * sends the history from before a project was turned on, or a project that is not on at all.
 *
 * The keys are the ones `nina langfuse login` kept, or `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and
 * `LANGFUSE_HOST` from the environment — never a flag, since a flag lands in shell history.
 *
 * Langfuse keeps what it is first sent, so each run is sent once: its trace when it has settled, and its
 * verdict score once it has a verdict and its trace is there. What was sent is kept per project beside
 * the snapshots, written after every request that succeeds, so a retry sends only what did not go. The
 * one way a span can still go twice is a request Langfuse took whose answer never arrived. A record that
 * changes after it was sent is counted and said, not sent again.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRun, runFile } from '../agentrun.mjs';
import { BATCH, SETTLE_MINUTES, postScore, postScores, postSpans, scoreOf, settled, spanOf, spansOf } from '../langfuse.mjs';
import { transcriptsOf } from '../transcripts.mjs';
import { exportsDir, snapshotsDir } from '../paths.mjs';
import { readConfig, statusPath, targetOf } from './langfuse.mjs';
import { projectName } from './stats.mjs';

/** The CLI, for the export the detector starts in the background. */
const BIN = fileURLToPath(new URL('../../bin/nina.mjs', import.meta.url));

/**
 * The largest request body sent, and the harder cuts for a dispatch that alone is larger. Langfuse takes
 * 5 MB; a smaller request is quicker to upload, which keeps it inside the wait a batch of spans is given.
 */
export const MAX_BODY = 1_000_000;
const SMALLER = [
  { text: 5_000, tool: 2_000 },
  { text: 1_000, tool: 300 },
];

/** Scores per ingestion request. */
const SCORES_PER_REQUEST = 100;

/** What a record held when it was sent, as a digest: a record that changes afterwards is noticed. */
export const digest = (record) => createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16);

/** Where each project's record of what was sent lives. */
const sentPath = (slug) => join(exportsDir(), 'langfuse', `${slug}.json`);

/** Reads one project's snapshot records. */
async function recordsOf(file) {
  return (await readFile(file, 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

/**
 * What was sent for a project: a digest per span, and the scores. Only a file that is not there means
 * nothing was sent; one that cannot be read is an error, because reading it as empty would send the
 * project's whole history again, and Langfuse would keep both copies.
 *
 * @returns {Promise<{spans: object, scores: object}|string>} The record, or why it could not be read.
 */
async function sentOf(slug) {
  let text;
  try {
    text = await readFile(sentPath(slug), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { spans: {}, scores: {} };
    return `${sentPath(slug)} could not be read — ${error.message}`;
  }
  try {
    const sent = JSON.parse(text);
    if (!sent || typeof sent.spans !== 'object' || typeof sent.scores !== 'object') throw new Error('not the shape written');
    return sent;
  } catch (error) {
    return `${sentPath(slug)} is damaged (${error.message}); nothing was sent, since reading it as empty would send everything again — move it aside only if Langfuse holds none of this project`;
  }
}

/**
 * Holds a project's export for one run. Two at once would each read what was sent before either wrote,
 * and send the same runs twice. A lock left by a run that died is taken over: it names its process.
 *
 * @returns {Promise<(() => Promise<void>)|null>} The release, or null when another export holds it.
 */
async function lock(slug) {
  await mkdir(join(exportsDir(), 'langfuse'), { recursive: true });
  const path = join(exportsDir(), 'langfuse', `${slug}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => rm(path, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(path, 'utf8').catch(() => ''));
      let alive = false;
      try {
        alive = pid > 0 && process.kill(pid, 0);
      } catch (e) {
        alive = e.code === 'EPERM';
      }
      if (alive) return null;
      await rm(path, { force: true });
    }
  }
  return null;
}

/** Writes it by rename, so an interruption leaves the last whole version. */
async function keep(slug, sent) {
  await mkdir(join(exportsDir(), 'langfuse'), { recursive: true });
  await writeFile(`${sentPath(slug)}.tmp`, JSON.stringify(sent));
  await rename(`${sentPath(slug)}.tmp`, sentPath(slug));
}

/**
 * What is due for one project: the settled runs whose span has not been sent, the runs with a verdict
 * whose span is sent (or about to be) and whose score is not, and the runs that changed since they went.
 *
 * @param {object[]} records - The project's snapshot records.
 * @param {{spans: object, scores: object}} sent
 * @param {Date} [now]
 * @param {string} [since] - ISO time; runs dispatched before it are left alone — a project turned on
 *   sends what it does from then on, and its history only when asked.
 */
export function due(records, sent, now = new Date(), since = '') {
  const spans = records.filter((r) => r.dispatch_id && !sent.spans[r.dispatch_id] && String(r.ts) >= since && settled(r, now) && spanOf(r, ''));
  const going = new Set(spans.map((r) => r.dispatch_id));
  const scores = records.filter((r) => (sent.spans[r.dispatch_id] || going.has(r.dispatch_id)) && !sent.scores[r.dispatch_id] && scoreOf(r));
  const changed = records.filter((r) => sent.spans[r.dispatch_id] && sent.spans[r.dispatch_id] !== digest(r)).length;
  const unsent = records.filter((r) => r.dispatch_id && !sent.spans[r.dispatch_id] && String(r.ts ?? '9') >= since);
  const timeless = unsent.filter((r) => !Number.isFinite(Date.parse(r.result_ts ?? r.ts))).length;
  const waiting = unsent.filter((r) => Number.isFinite(Date.parse(r.result_ts ?? r.ts)) && !settled(r, now)).length;
  return { spans, scores, changed, waiting, timeless };
}

/**
 * What the `lessons` detector does for a project that is on, after its snapshot: start the export in the
 * background when a run is ready to go, and say once when the last one failed. The detector runs on every
 * turn, before the person sees the answer, so it never waits on the network itself.
 *
 * @param {string} slug - The project's snapshot name.
 * @param {object[]} records - Its records, just snapshotted.
 * @param {Date} [now]
 * @returns {Promise<string|null>} A finding for the detector to report, or null.
 */
export async function autoExport(slug, records, now = new Date()) {
  if (process.env.NINA_UPGRADE) return null;
  const setting = (await readConfig()).projects[slug];
  if (!setting) return null;
  let finding = null;
  const last = JSON.parse(await readFile(statusPath(slug), 'utf8').catch(() => 'null'));
  if (last?.error && !last.reported) {
    finding = `the export to Langfuse failed (${last.at}) — ${last.error}; \`nina langfuse status\` says where it stands`;
    await writeFile(statusPath(slug), JSON.stringify({ ...last, reported: true }));
  }
  const sent = await sentOf(slug);
  if (typeof sent === 'string') return finding ?? sent;
  const todo = due(records, sent, now, setting.since);
  if (todo.spans.length > 0 || todo.scores.length > 0) {
    spawn(process.execPath, [BIN, 'export', '--langfuse', '--auto', '--project', slug], { detached: true, stdio: 'ignore', env: process.env }).unref();
  }
  return finding;
}

/**
 * @param {string[]} argv - Command arguments.
 * @param {{fetch?: typeof fetch, now?: Date}} [ctx] - For tests: the request function and the clock.
 * @returns {Promise<number>} Process exit code.
 */
export async function exportCommand(argv, ctx = {}) {
  if (!argv.includes('--langfuse')) {
    console.error('  usage: nina export --langfuse [--project <name>] [--dry-run]\n');
    return 2;
  }
  const dry = argv.includes('--dry-run');
  const auto = argv.includes('--auto');
  const only = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : null;
  const config = await readConfig();
  const target = { ...targetOf(config), fetch: ctx.fetch };

  // In the background, for one project that is on: nothing to say to anyone, so what happened goes where
  // `nina langfuse status` and the next detector run read it.
  if (auto) {
    const setting = config.projects[only ?? ''];
    if (!setting || !target.publicKey || !target.secretKey) return 0;
    const release = await lock(only);
    if (!release) return 0;
    try {
      const result = await exportProject({ slug: only, name: projectName(only), file: join(snapshotsDir(), `${only}.jsonl`), target, now: ctx.now, since: setting.since, quiet: true, content: setting.content });
      if (result.spans > 0 || result.scores > 0 || result.error) {
        // The same failure again is not news: it was reported once, and repeating it every turn it is
        // retried would be the noise the detectors exist to remove.
        const before = JSON.parse(await readFile(statusPath(only), 'utf8').catch(() => 'null'));
        const reported = Boolean(result.error && before?.error === result.error && before.reported);
        await writeFile(statusPath(only), JSON.stringify({ at: new Date().toISOString(), spans: result.spans, scores: result.scores, error: result.error, reported }));
      }
      return result.error ? 1 : 0;
    } finally {
      await release();
    }
  }

  if (!dry && (!target.publicKey || !target.secretKey)) {
    console.error('  no keys — `nina langfuse login`, or set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY\n');
    return 2;
  }

  const dir = snapshotsDir();
  const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.jsonl')) : [];
  const slugs = files.map((f) => f.replace(/\.jsonl$/, '')).filter((s) => !only || s === only || s.endsWith(`-${only}`));
  if (slugs.length === 0) {
    console.error(only ? `  no snapshot for a project named "${only}"\n` : '  no snapshots yet — run `nina snapshot`\n');
    return 1;
  }

  let failed = false;
  for (const slug of slugs) {
    const name = projectName(slug);
    const release = dry ? async () => {} : await lock(slug);
    if (!release) {
      console.log(`  ${name}: ✗ another export of this project is running — nothing sent`);
      failed = true;
      continue;
    }
    try {
      const content = Boolean(config.projects[slug]?.content);
      if ((await exportProject({ slug, name, file: join(dir, `${slug}.jsonl`), target, dry, now: ctx.now, content })).error) failed = true;
    } finally {
      await release();
    }
  }
  return failed ? 1 : 0;
}

/**
 * Sends what is due for one project, or says what would go.
 *
 * @returns {Promise<{spans: number, scores: number, error: string|null}>} What went, and why the rest did not.
 */
async function exportProject({ slug, name, file, target, dry, now, since = '', quiet = false, content = false }) {
  const say = quiet ? () => {} : (line) => console.log(line);
  const records = await recordsOf(file);
  const sent = await sentOf(slug);
  if (typeof sent === 'string') {
    say(`  ${name}: ✗ ${sent}`);
    return { spans: 0, scores: 0, error: sent };
  }
  const todo = due(records, sent, now, since);
  const notes = [
    todo.waiting ? `${todo.waiting} run(s) still running, or returned under ${SETTLE_MINUTES} minutes ago` : '',
    todo.timeless ? `${todo.timeless} record(s) have no time to place them at, and are never sent` : '',
    todo.changed ? `${todo.changed} run(s) changed after they were sent, and Langfuse keeps them as first sent` : '',
  ].filter(Boolean);
  const tail = () => (notes.length ? ` — ${notes.join('; ')}` : '');

  if (dry) {
    say(`  ${name}: would send ${todo.spans.length} trace(s)${content ? " with each stage's context" : ''} and ${todo.scores.length} score(s) to ${target.host}${tail()}`);
    if (todo.spans[0]) say(`    e.g. ${JSON.stringify(spanOf(todo.spans[0], name))}`);
    return { spans: 0, scores: 0, error: null };
  }
  if (todo.spans.length === 0 && todo.scores.length === 0) {
    say(`  ${name}: nothing new${tail()}`);
    return { spans: 0, scores: 0, error: null };
  }

  let spans = 0;
  let scores = 0;
  let error = null;
  let bare = 0;
  let oversized = 0;
  const flush = async (batch) => {
    const answer = await postSpans(batch.flatMap((b) => b.spans), target);
    error = answer.error;
    if (!answer.taken) return;
    // Taken is sent, even when part of it was refused: which spans were kept cannot be known, and
    // sending the batch again would double the ones that were. Its runs get no score, for the same
    // reason — a score must not point at an observation Langfuse may not have.
    for (const { record } of batch) {
      sent.spans[record.dispatch_id] = digest(record);
      if (error) sent.scores[record.dispatch_id] = 'withheld';
    }
    spans += batch.length;
    await keep(slug, sent);
  };
  // Requests are packed by size as well as count, a dispatch whole: split across two, a failure after
  // the first would leave half of it in Langfuse and a retry would send that half again. One too large
  // for a request on its own has its texts cut harder until it fits.
  let batch = [];
  let bytes = 0;
  for (const record of todo.spans) {
    if (error) break;
    const run = content ? await readRun(runFile(transcriptsOf(slug), record)) : null;
    if (content && !run) bare += 1;
    let built = spansOf(record, name, run);
    let size = JSON.stringify(built).length;
    for (const limits of SMALLER) {
      if (size <= MAX_BODY) break;
      built = spansOf(record, name, run, limits);
      size = JSON.stringify(built).length;
    }
    // Cutting its texts bounds each one, not how many calls a stage made. One that still does not fit
    // goes as the record alone: refused as it was, it would fail every turn and hold back every run after it.
    if (size > MAX_BODY) {
      built = spansOf(record, name, null);
      size = JSON.stringify(built).length;
      oversized += 1;
    }
    if (batch.length > 0 && (batch.length >= BATCH || bytes + size > MAX_BODY)) {
      await flush(batch);
      batch = [];
      bytes = 0;
      if (error) break;
    }
    batch.push({ record, spans: built });
    bytes += size;
  }
  if (batch.length > 0 && !error) await flush(batch);
  if (bare > 0) notes.push(`${bare} went without their context — the transcript was gone`);
  if (oversized > 0) notes.push(`${oversized} went without their context — too large for a request even cut down`);
  // A score goes only beside a span Langfuse has: a batch that failed takes its runs' scores with it.
  const ready = error ? [] : todo.scores.filter((r) => sent.spans[r.dispatch_id] && !sent.scores[r.dispatch_id]);
  let refused = 0;
  let single = false;
  for (let i = 0; i < ready.length; i += SCORES_PER_REQUEST) {
    const group = ready.slice(i, i + SCORES_PER_REQUEST);
    let taken = new Set();
    if (!single) {
      const answer = await postScores(group.map(scoreOf), target);
      taken = answer.taken;
      error ??= answer.gone ? null : answer.error;
      single = answer.gone;
    }
    // Where the batched endpoint is gone, one by one — stopping at the first refusal, which on the free
    // plan is the rate limit: the next turn sends the rest.
    let stopped = false;
    if (single) {
      for (const r of group) {
        const failed = await postScore(scoreOf(r), target);
        if (failed) {
          error ??= failed;
          stopped = true;
          break;
        }
        taken.add(scoreOf(r).id);
      }
    }
    for (const r of group) {
      if (!taken.has(scoreOf(r).id)) continue;
      sent.scores[r.dispatch_id] = 1;
      scores += 1;
    }
    refused += group.length - group.filter((r) => taken.has(scoreOf(r).id)).length;
    await keep(slug, sent);
    if (taken.size === 0 || stopped) break;
  }
  const why = error ? ` — ✗ ${refused ? `${refused} score(s) refused: ` : ''}${error}` : '';
  say(`  ${name}: sent ${spans} trace(s) and ${scores} score(s)${why}${tail()}`);
  return { spans, scores, error };
}
