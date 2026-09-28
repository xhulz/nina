/**
 * The measurement store, read one way by every report.
 *
 * Five readers each parsed `~/.nina/snapshots/<project>.jsonl` their own way — `stats`, `runs`, `learn`,
 * `export` and `status` — and chose the project four different ways, so two reports on the same history
 * disagreed and neither said why. Every report reads it here now. Only `snapshot`, which rewrites the file,
 * reads it raw.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { slugFor, snapshotsDir } from './paths.mjs';
import { ROLE_TOKENS } from './transcripts.mjs';

/** What a record says when no verdict was read from its report. */
const UNREAD = new Set(['UNCLEAR', 'NONE', null, undefined]);

/**
 * Records from a store file's text. A torn line loses one record, never the file.
 *
 * @param {string} text - The file.
 * @returns {object[]}
 */
export function parseStore(text) {
  return String(text)
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
 * A record as the reports read it. A verdict outside the vocabulary of the role that gave it is not a
 * verdict that role can give: records captured before the classifier knew the role read a dba's report
 * as `PASS`, qa's token, and 21 of those made a gate that had stopped one change in fourteen look like a
 * rubber stamp. Kept in the store as captured, and read as unreadable.
 *
 * @param {object} record - As captured.
 * @returns {object}
 */
export function asRead(record) {
  const tokens = ROLE_TOKENS[record?.role];
  if (!tokens || UNREAD.has(record.verdict) || tokens.includes(record.verdict)) return record;
  return { ...record, verdict: 'UNCLEAR', verdict_source: 'outside-role' };
}

/**
 * Every record in one store file.
 *
 * @param {string} file - The file.
 * @param {{raw?: boolean}} [options] - `raw`: as captured, for the one writer of the store.
 * @returns {object[]} Empty when there is no such file.
 */
export function readStoreFile(file, { raw = false } = {}) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const records = parseStore(text);
  return raw ? records : records.map(asRead);
}

/**
 * The store names a project's records may be under: its path as given, and with its links resolved, since
 * either may be the one its sessions ran in.
 *
 * @param {string} dir - The project.
 * @returns {string[]}
 */
export function storeNamesOf(dir) {
  const names = new Set([slugFor(dir)]);
  try {
    names.add(slugFor(realpathSync(dir)));
  } catch {
    // A directory that cannot be resolved is looked up as given.
  }
  return [...names];
}

/**
 * A project's records.
 *
 * @param {string} dir - The project.
 * @param {string} [store] - The store directory.
 * @returns {object[]|null} Null when the store has nothing for it.
 */
export function projectRecords(dir, store = snapshotsDir()) {
  for (const name of storeNamesOf(dir)) {
    const file = join(store, `${name}.jsonl`);
    if (existsSync(file)) return readStoreFile(file);
  }
  return null;
}

/**
 * The store names a `--project` value picks, one rule for every report. A directory is that project, by the
 * name its sessions ran under; anything else is a store name, exactly, or else every name that contains it.
 * `stats --project ../thing` read the directory as a piece of a name, found none, and said to run a snapshot.
 *
 * @param {string} value - What was given.
 * @param {string} [store] - The store directory.
 * @returns {string[]}
 */
export function namesFor(value, store = snapshotsDir()) {
  const names = (() => {
    try {
      return readdirSync(store).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -'.jsonl'.length));
    } catch {
      return [];
    }
  })();
  let isDir = false;
  try {
    isDir = statSync(resolve(value)).isDirectory();
  } catch {
    // Not a directory here: a name.
  }
  if (isDir) return storeNamesOf(resolve(value)).filter((n) => names.includes(n));
  if (names.includes(value)) return [value];
  return names.filter((n) => n.includes(value));
}

/** Two digits. */
const two = (n) => String(n).padStart(2, '0');

/**
 * The day a moment fell on where this machine is, as `YYYY-MM-DD`. The store keeps UTC; the reports read
 * the owner's day. Cut from the UTC string, `--since` and the days a report printed moved a round from the
 * evening it ran in to the next morning for anyone west of Greenwich — 20 of one project's 130.
 *
 * @param {unknown} ts - An ISO timestamp.
 * @returns {string} The day, or the first ten characters of whatever could not be read as a moment.
 */
export function localDay(ts) {
  const d = new Date(String(ts ?? ''));
  return Number.isNaN(d.getTime()) ? String(ts ?? '').slice(0, 10) : `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * A moment where this machine is, as `YYYY-MM-DD HH:MM`.
 *
 * @param {unknown} ts - An ISO timestamp.
 * @returns {string}
 */
export function localMinute(ts) {
  const d = new Date(String(ts ?? ''));
  return Number.isNaN(d.getTime()) ? String(ts ?? '') : `${localDay(ts)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The zone the reports read days in, named where a report prints a time. */
export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local time';
