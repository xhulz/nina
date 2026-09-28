/**
 * A lock file that names the process holding it, for the commands that must not run twice at once on one
 * project: two snapshots would leave one's cursors beside the other's records, two exports would send the same
 * runs twice.
 *
 * The file appears with the pid already in it — written aside, then linked into place, which fails when a lock
 * is there — so it is never read empty and taken for a dead one's. A lock whose process died is removed only by
 * the taker holding its takeover, and only once it has read the holder again under it: each taker removed it
 * outright before, after its own read, and the second removed the lock the first had just taken, so both held it.
 */

import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Whether a process is running. One this user may not signal is running too. */
function alive(pid) {
  if (!(pid > 0)) return false;
  try {
    return process.kill(pid, 0);
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** The pid a lock file names — 0 when it names none — or undefined when there is no file. */
async function holder(path) {
  try {
    return Number(await readFile(path, 'utf8')) || 0;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** A name beside the lock no other taker uses, in this process or another. */
const aside = (path) => `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;

/** Puts a file naming this process at `path`, unless one is there. */
async function place(path) {
  const mine = aside(path);
  await writeFile(mine, String(process.pid));
  try {
    await link(mine, path);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  } finally {
    await rm(mine, { force: true });
  }
}

/**
 * Takes a lock, or says it is held.
 *
 * @param {string} path - The lock file.
 * @returns {Promise<(() => Promise<void>)|null>} Its release, or null when a running process holds it.
 */
export async function takeLock(path) {
  await mkdir(dirname(path), { recursive: true });
  const takeover = `${path}.takeover`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await place(path)) return () => rm(path, { force: true });
    if (alive(await holder(path))) return null;
    if (!(await place(takeover))) {
      const taker = await holder(takeover);
      if (alive(taker)) return null;
      // A taker that died mid-takeover. One that finished is simply gone: try again.
      if (taker !== undefined) await rm(takeover, { force: true });
      continue;
    }
    try {
      // Under the takeover nobody else removes the lock, and nobody can link over it: a lock read now stays what
      // it is. A missing one does not — a taker may link it in the next instant — so there is nothing to remove.
      const pid = await holder(path);
      if (pid !== undefined && !alive(pid)) await rm(path, { force: true });
    } finally {
      await rm(takeover, { force: true });
    }
  }
  return null;
}
