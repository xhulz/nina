/**
 * `nina snapshot` — captures pipeline history from the Claude Code transcripts into a
 * file that survives them.
 *
 * The transcripts are pruned; the snapshot is the durable asset. Two properties matter:
 * it is idempotent, so re-running never duplicates a dispatch, and it is incremental, so
 * it re-reads only what was appended since the last run — this runs from a Stop hook and
 * the transcripts are hundreds of megabytes and growing.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { snapshotsDir } from '../paths.mjs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { listProjects, scanProject } from '../transcripts.mjs';

/** Where per-project read cursors live, beside the snapshots they describe. */
const STATE_FILE = '.state.json';

/**
 * Reads a JSON file, or an empty object when it is missing or unreadable. A state file cut short
 * by an interrupted write used to throw on every later snapshot, and observation stopped for every
 * project on the machine with nothing saying so. An unreadable cursor costs one re-read.
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
  await writeFile(tmp, text);
  await rename(tmp, path);
}

/**
 * Reads the records already captured for a project.
 *
 * @param {string} file - Path to the snapshot JSONL.
 * @returns {Promise<object[]>} The records, or an empty list.
 */
async function readRecords(file) {
  const records = [];
  try {
    await readFile(file, { flag: 'r' });
  } catch {
    return records;
  }
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* a torn line loses one record, never the file */
    }
  }
  return records;
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
  await writeFile(tmp, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  await rename(tmp, file);
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
  // The cursors used to live in one file shared by every project, rewritten whole and in place.
  // Two snapshots at once — the global hook and a project's own detector, or two sessions ending
  // together — each read all of it, updated their own project, and wrote all of it back: the later
  // writer silently put every other project's cursor back where it had been, and a cursor that
  // goes back re-reads history. Each project now has its own, beside its records, written by
  // rename. The shared file is still read, once, so a project's cursor is not lost in the move.
  const legacy = rebuild ? {} : await readJson(join(outDir, STATE_FILE));

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
    const file = join(outDir, `${project.slug}.jsonl`);
    const prior = rebuild ? [] : await readRecords(file);
    const own = rebuild ? {} : await readJson(join(outDir, `${project.slug}.state.json`));
    const cursors = rebuild ? {} : (own.cursors ?? legacy[project.slug]?.cursors ?? {});

    const scanned = await scanProject(project.dir, { cursors, records: prior });
    const records = scanned.records.map((r) => ({ project: project.slug, ...r }));
    if (records.length === 0) continue;

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
    totalNew += Math.max(0, fresh);

    if (!quiet) {
      const span = `${String(records[0].ts).slice(0, 10)} → ${String(records.at(-1).ts).slice(0, 10)}`;
      console.log(
        `  ${project.slug.padEnd(48)} ${String(records.length).padStart(5)} dispatches  ` +
          `${String(fresh).padStart(5)} new  ${span}`,
      );
    }
  }


  if (!quiet) {
    console.log(`\n  ${totalNew} new dispatch${totalNew === 1 ? '' : 'es'} captured → ${outDir}`);
  }
  return 0;
}
