/**
 * `nina export --langfuse` — the measured history, sent to Langfuse.
 *
 *   nina export --langfuse [--project <name>] [--dry-run]
 *
 * Credentials come from the environment, never a flag, since a flag lands in shell history:
 * `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_HOST` (or `LANGFUSE_BASE_URL`), which
 * defaults to Langfuse's EU cloud. What is sent is metadata only — see `src/langfuse.mjs`.
 *
 * Langfuse keeps what it is first sent, so each run is sent once: its span when it has settled, and its
 * verdict score once it has a verdict and its span is there. What was sent is kept per project beside
 * the snapshots, written after every request that succeeds, so a retry sends only what did not go. The
 * one way a span can still go twice is a request Langfuse took whose answer never arrived. A record that
 * changes after it was sent is counted and said, not sent again.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { BATCH, DEFAULT_HOST, SETTLE_HOURS, postScore, postSpans, scoreOf, settled, spanOf } from '../langfuse.mjs';
import { exportsDir, slugFor, snapshotsDir } from '../paths.mjs';
import { decodeProjectDir } from './stats.mjs';

/** Scores sent at once: the endpoint takes one per request. */
const SCORES_AT_ONCE = 8;

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
 */
export function due(records, sent, now = new Date()) {
  const spans = records.filter((r) => r.dispatch_id && !sent.spans[r.dispatch_id] && settled(r, now) && spanOf(r, ''));
  const going = new Set(spans.map((r) => r.dispatch_id));
  const scores = records.filter((r) => (sent.spans[r.dispatch_id] || going.has(r.dispatch_id)) && !sent.scores[r.dispatch_id] && scoreOf(r));
  const changed = records.filter((r) => sent.spans[r.dispatch_id] && sent.spans[r.dispatch_id] !== digest(r)).length;
  const unsent = records.filter((r) => r.dispatch_id && !sent.spans[r.dispatch_id]);
  const timeless = unsent.filter((r) => !Number.isFinite(Date.parse(r.result_ts ?? r.ts))).length;
  const waiting = unsent.filter((r) => Number.isFinite(Date.parse(r.result_ts ?? r.ts)) && !settled(r, now)).length;
  return { spans, scores, changed, waiting, timeless };
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
  const only = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : null;
  const target = {
    host: process.env.LANGFUSE_HOST ?? process.env.LANGFUSE_BASE_URL ?? DEFAULT_HOST,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
    fetch: ctx.fetch,
  };
  if (!dry && (!target.publicKey || !target.secretKey)) {
    console.error("  set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY (a project's API keys, Settings → API Keys), and LANGFUSE_HOST if not the EU cloud\n");
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
    // The name a project goes by in Langfuse is its directory's, not the flattened path, which carries
    // the owner's home directory to a service that has no use for it. A directory that is gone cannot
    // be split back into its parts, so the name is the path below home, flattened as it was.
    const decoded = decodeProjectDir(slug);
    const home = `${slugFor(homedir())}-`;
    const name = decoded ? basename(decoded) : slug.startsWith(home) ? slug.slice(home.length) : slug.replace(/^-+/, '');
    const release = dry ? async () => {} : await lock(slug);
    if (!release) {
      console.log(`  ${name}: ✗ another export of this project is running — nothing sent`);
      failed = true;
      continue;
    }
    try {
      if (!(await exportProject({ slug, name, file: join(dir, `${slug}.jsonl`), target, dry, now: ctx.now }))) failed = true;
    } finally {
      await release();
    }
  }
  return failed ? 1 : 0;
}

/**
 * Sends what is due for one project, or says what would go.
 *
 * @returns {Promise<boolean>} Whether everything due went.
 */
async function exportProject({ slug, name, file, target, dry, now }) {
  const records = await recordsOf(file);
  const sent = await sentOf(slug);
  if (typeof sent === 'string') {
    console.log(`  ${name}: ✗ ${sent}`);
    return false;
  }
  const todo = due(records, sent, now);
  const notes = [
    todo.waiting ? `${todo.waiting} run(s) still settling, finished under ${SETTLE_HOURS}h ago` : '',
    todo.timeless ? `${todo.timeless} record(s) have no time to place them at, and are never sent` : '',
    todo.changed ? `${todo.changed} run(s) changed after they were sent, and Langfuse keeps them as first sent` : '',
  ].filter(Boolean);
  const tail = notes.length ? ` — ${notes.join('; ')}` : '';

  if (dry) {
    console.log(`  ${name}: would send ${todo.spans.length} span(s) and ${todo.scores.length} score(s) to ${target.host}${tail}`);
    if (todo.spans[0]) console.log(`    e.g. ${JSON.stringify(spanOf(todo.spans[0], name))}`);
    return true;
  }
  if (todo.spans.length === 0 && todo.scores.length === 0) {
    console.log(`  ${name}: nothing new${tail}`);
    return true;
  }

  let spans = 0;
  let scores = 0;
  let error = null;
  for (let i = 0; i < todo.spans.length && !error; i += BATCH) {
    const batch = todo.spans.slice(i, i + BATCH);
    const answer = await postSpans(batch.map((r) => spanOf(r, name)), target);
    error = answer.error;
    if (!answer.taken) break;
    // Taken is sent, even when part of it was refused: which spans were kept cannot be known, and
    // sending the batch again would double the ones that were. Its runs get no score, for the same
    // reason — a score must not point at an observation Langfuse may not have.
    for (const r of batch) {
      sent.spans[r.dispatch_id] = digest(r);
      if (error) sent.scores[r.dispatch_id] = 'withheld';
    }
    spans += batch.length;
    await keep(slug, sent);
  }
  // A score goes only beside a span Langfuse has: a batch that failed takes its runs' scores with it.
  // One score refused does not hold back the rest, or a single bad one would block every later run's;
  // a whole group refused means the endpoint is down, and the run stops rather than knock on.
  const ready = error ? [] : todo.scores.filter((r) => sent.spans[r.dispatch_id] && !sent.scores[r.dispatch_id]);
  let refused = 0;
  for (let i = 0; i < ready.length; i += SCORES_AT_ONCE) {
    const group = ready.slice(i, i + SCORES_AT_ONCE);
    const results = await Promise.all(group.map((r) => postScore(scoreOf(r), target)));
    group.forEach((r, j) => {
      if (results[j]) return;
      sent.scores[r.dispatch_id] = 1;
      scores += 1;
    });
    refused += results.filter(Boolean).length;
    error ??= results.find(Boolean) ?? null;
    await keep(slug, sent);
    if (results.every(Boolean)) break;
  }
  const why = error ? ` — ✗ ${refused ? `${refused} score(s) refused: ` : ''}${error}` : '';
  console.log(`  ${name}: sent ${spans} span(s) and ${scores} score(s)${why}${tail}`);
  return !error;
}
