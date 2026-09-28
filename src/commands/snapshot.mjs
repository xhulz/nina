/**
 * `nina snapshot` — captures pipeline history from the Claude Code transcripts into a
 * file that survives them.
 *
 * The transcripts are pruned; the snapshot is the durable asset. Two properties matter:
 * it is idempotent, so re-running never duplicates a dispatch, and it is incremental, so
 * it re-reads only what was appended since the last run — this runs from a Stop hook and
 * the transcripts are hundreds of megabytes and growing.
 */

import { copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { HARNESS, snapshotsDir } from '../paths.mjs';
import { decodeProjectDir } from './stats.mjs';
import { readStoreFile } from '../store.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listProjects, scanProject } from '../transcripts.mjs';

/**
 * Reads a JSON file, or an empty object when it is missing or unreadable. A state file cut short
 * by an interrupted write used to throw on every later snapshot, and observation stopped for every
 * project on the machine with nothing saying so. An unreadable cursor costs one re-read, which keeps what the
 * store already holds (`snapshotProject`).
 *
 * @param {string} path - The file.
 * @returns {Promise<object>}
 */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Writes text by rename, so a reader never sees half of it.
 *
 * @param {string} path - The destination.
 * @param {string} text - The content.
 */
async function writeAtomicText(path, text) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, path);
}

/**
 * Writes the snapshot through a temp file, so an interrupted run cannot leave a
 * truncated one behind.
 *
 * @param {string} file - Destination path.
 * @param {object[]} records - Records to write, one JSON object per line.
 */
async function writeAtomic(file, records) {
  // Unique per writer: two snapshots of one project at once used the same temporary name, and
  // could interleave into it before either renamed it into place.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  // Its owner's alone: it holds each dispatch's description, which the orchestrator wrote.
  await writeFile(tmp, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

/**
 * Takes a project's lock, or says it is taken. The records and the cursors are written one after the other,
 * and two snapshots of one project at once — a project's own detector and a global hook, both on every
 * Stop — could leave the cursors of the scan that read further beside the records of the one that read less,
 * and whatever lay between was never captured. One that finds the lock taken skips the project: the next
 * snapshot reads from where this one leaves it. A lock names its process, so one left by a snapshot that
 * died is taken over.
 *
 * @param {string} path - The lock file.
 * @returns {Promise<(() => Promise<void>)|null>} Its release, or null when another snapshot holds it.
 */
async function lock(path) {
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

/**
 * Runs the snapshot.
 *
 * @param {string[]} argv - Command arguments.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function snapshot(argv, ctx) {
  const outDir = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : snapshotsDir();
  const filterIdx = argv.findIndex((a) => a === '--project');
  const filter = filterIdx >= 0 ? argv[filterIdx + 1] : null;
  /** Discards cursors and re-reads everything — for when the record shape grows. */
  const rebuild = argv.includes('--rebuild');
  /** Silent mode for the hook: capture and say nothing. */
  const quiet = argv.includes('--quiet');

  await mkdir(outDir, { recursive: true });
  const projects = await listProjects();
  // `--exact` for a caller that knows the slug — a project's own detector. A substring also
  // matched every project nested under it, and snapshotted them all on every turn.
  const exact = argv.includes('--exact');
  const targets = filter ? projects.filter((p) => (exact ? p.slug === filter : p.slug.includes(filter))) : projects;

  if (targets.length === 0) {
    if (!quiet) console.error(filter ? `no project matching "${filter}"` : 'no transcripts found');
    return quiet ? 0 : 1;
  }

  let totalNew = 0;
  for (const project of targets) {
    const release = await lock(join(outDir, `${project.slug}.lock`));
    if (!release) continue;
    try {
      totalNew += await snapshotProject(project, { outDir, rebuild, quiet });
    } finally {
      await release();
    }
  }

  if (!quiet) {
    console.log(`\n  ${totalNew} new round${totalNew === 1 ? '' : 's'} captured → ${outDir}`);
  }
  return 0;
}

/** Whether a round's verdict came from the report it handed back: the one reading nothing later corrects. */
const settledByHandback = (r) => r?.verdict_source === 'handback';

/**
 * A round as a re-read after lost cursors leaves it. What the store held stands, field by field, and the
 * re-read fills only what it lacked — unless the re-read settled the round from the report its stage handed
 * back and the store had not: a verdict read from a notification is the one a handback corrects, and kept
 * over it, a round the store had as REJECTED stayed so after its stage had said APPROVED, and stayed so for
 * good once that stage's transcript was pruned.
 *
 * @param {object} held - The round as the store held it.
 * @param {object} reread - The round as the re-read found it.
 * @returns {object}
 */
export function rereadOver(held, reread) {
  const defined = (record) => Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null && v !== undefined));
  return settledByHandback(reread) && !settledByHandback(held) ? { ...held, ...defined(reread) } : { ...reread, ...defined(held) };
}

/**
 * The release a project pins now, or null when its directory or profile cannot be found.
 *
 * @param {string} slug - Its store name.
 * @returns {string|null}
 */
function pinOf(slug) {
  const dir = decodeProjectDir(slug);
  if (!dir) return null;
  try {
    const core = JSON.parse(readFileSync(join(dir, HARNESS, 'profile.json'), 'utf8')).core;
    return typeof core === 'string' ? core : null;
  } catch {
    return null;
  }
}

/**
 * Snapshots one project, under its lock.
 *
 * @returns {Promise<number>} How many rounds it captured that were not on record.
 */
async function snapshotProject(project, { outDir, rebuild, quiet }) {
  const file = join(outDir, `${project.slug}.jsonl`);
  // The store is the only copy of history older than the transcripts, and a rebuild re-reads only what is
  // still on disk: the record it replaces is kept beside it first.
  if (rebuild && existsSync(file)) await copyFile(file, `${file}.before-rebuild-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const stored = readStoreFile(file, { raw: true });
  const prior = rebuild ? [] : stored;
  // Each project's read cursors live beside its records, written by rename. They once shared one file, rewritten
  // whole: two snapshots at once each wrote every other project's cursor back where it had been, and a cursor
  // that goes back re-reads history.
  const own = rebuild ? {} : await readJson(join(outDir, `${project.slug}.state.json`));
  const cursors = rebuild ? {} : (own.cursors ?? {});

  const scanned = await scanProject(project.dir, { cursors, records: prior });
  // With its cursors gone — a state file deleted, or cut short — the transcripts are read again from the start
  // over records the store already holds, and read that way a notification is taken a second time: one
  // project had 34 verdicts, 639 return times and 79 durations rewritten. What the store held stands, field
  // by field, and the re-read adds only what it lacked; the cursors it leaves hold from then on.
  const reread = !rebuild && prior.length > 0 && Object.keys(cursors).length === 0;
  const held = new Map(prior.map((r) => [r.dispatch_id, r]));
  const kept = (r) => (reread && held.has(r.dispatch_id) ? rereadOver(held.get(r.dispatch_id), r) : r);
  // The release the project pinned when a round was first captured, so a rule is judged only on the rounds
  // that ran under it. A round already on record keeps what it had — a rebuild included, which would
  // otherwise stamp today's pin on weeks of history — and only a new one takes today's.
  const pinned = new Map(stored.map((r) => [r.dispatch_id, r.core ?? null]));
  const pin = pinOf(project.slug);
  const records = scanned.records.map(kept).map((r) => {
    const core = pinned.has(r.dispatch_id) ? pinned.get(r.dispatch_id) : pin;
    return { ...r, project: project.slug, ...(core ? { core } : {}) };
  });
  if (records.length === 0) return 0;

  const fresh = records.length - prior.length;
  // A prior record can change without the count changing — a field learned after it was
  // captured, filled in from its transcript — and a write gated on the count alone would
  // compute the backfill and throw it away.
  const changed =
    fresh !== 0 ||
    prior.length === 0 ||
    rebuild ||
    records.some((r, i) => JSON.stringify(r) !== JSON.stringify({ project: project.slug, ...prior[i] }));
  if (changed) await writeAtomic(file, records);
  await writeAtomicText(join(outDir, `${project.slug}.state.json`), `${JSON.stringify({ cursors: scanned.cursors, captured: records.length }, null, 2)}\n`);
  if (!quiet) {
    const span = `${String(records[0].ts).slice(0, 10)} → ${String(records.at(-1).ts).slice(0, 10)}`;
    console.log(
      `  ${project.slug.padEnd(48)} ${String(records.length).padStart(5)} rounds  ` +
        `${String(fresh).padStart(5)} new  ${span}`,
    );
  }
  return Math.max(0, fresh);
}
