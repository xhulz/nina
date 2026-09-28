/**
 * Where NINA keeps the things that are neither the package nor a project.
 *
 * The measured pipeline history used to live inside the install directory, which only
 * worked because the install directory was a clone of this repo. Once NINA is a package
 * that is wrong twice over: a dependency is not a place to write, and under `node_modules`
 * the next install would take the history with it. The history is the user's, spans every
 * project, and losing it is irreversible — so it lives in the user's own directory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The directory holding captured pipeline history.
 *
 * `NINA_DATA` overrides it, which is what the tests use rather than writing to a real home.
 *
 * @returns {string}
 */
export function snapshotsDir() {
  return process.env.NINA_DATA ? join(process.env.NINA_DATA, 'snapshots') : join(homedir(), '.nina', 'snapshots');
}

/**
 * The directory holding the loop gate's per-session ledgers.
 *
 * Beside the snapshots, and for the same reasons: it is the user's, it spans projects, and it is
 * metadata only — which stage reported which verdict token, which dispatch went out, when the owner
 * spoke. `NINA_DATA` moves it with everything else.
 *
 * @returns {string}
 */
export function gateDir() {
  return process.env.NINA_DATA ? join(process.env.NINA_DATA, 'gate') : join(homedir(), '.nina', 'gate');
}

/**
 * Where the Stop hook remembers what it last told the person, per project, so it does not tell them again.
 *
 * @returns {string}
 */
export function hookStateDir() {
  return process.env.NINA_DATA ? join(process.env.NINA_DATA, 'hooks') : join(homedir(), '.nina', 'hooks');
}

/**
 * Where `nina export` keeps what it has sent, per destination and project — beside the snapshots it reads.
 *
 * @returns {string}
 */
export function exportsDir() {
  return process.env.NINA_DATA ? join(process.env.NINA_DATA, 'exports') : join(homedir(), '.nina', 'exports');
}

/**
 * The commands typed into `nina` on a terminal, one a line, so the arrow keys reach the last session's.
 *
 * @returns {string}
 */
export function shellHistoryFile() {
  return process.env.NINA_DATA ? join(process.env.NINA_DATA, 'shell_history') : join(homedir(), '.nina', 'shell_history');
}

/**
 * How Claude Code names a project's transcript directory, and so its snapshot file and its gate
 * ledgers: the absolute path with every character that is not a letter or a digit made a dash.
 *
 * @param {string} dir - The project directory.
 * @returns {string}
 */
export const slugFor = (dir) => resolve(dir).replace(/[^A-Za-z0-9]/g, '-');

/**
 * The directory a project keeps its harness source in.
 *
 * It is named after the tool rather than after the concept, the way `.git` and `.turbo` are.
 * `.harness` said what the contents were and left out who maintained them, which is how it
 * read as a skeleton waiting to be filled rather than as one tool's input.
 *
 * Paths are built from this constant. Prose that names the directory spells it out, because
 * a rename would want the sentence rewritten anyway.
 */
export const HARNESS = '.nina';

/**
 * A sentence to append when a project has no profile, in case it has the old directory.
 *
 * The directory was called `.harness` until it was named after the tool. A project that
 * still has the old one reports exactly what a project that was never started reports, and
 * "run `nina init`" is the wrong advice for it — it would write a second profile beside a
 * complete one.
 *
 * @param {string} target - The project.
 * @returns {string} The hint, or an empty string when the old directory is not there.
 */
export function legacyHint(target) {
  return existsSync(join(target, '.harness'))
    ? ` — this project still has .harness/, which is what ${HARNESS}/ used to be called. Rename it; do not start over.`
    : '';
}

/**
 * Where `nina upgrade --apply` writes down a move while it is in flight: the versions it moves between, the
 * files it composes for the first time, and — under {@link movedFrom} — every file it can touch, as it was.
 * It is written before the pin moves and removed once the move is verified or rolled back, so one that is
 * still there is a move that was stopped half-way.
 *
 * @param {string} target - The project.
 * @returns {string}
 */
export const moveJournal = (target) => join(target, HARNESS, 'upgrade.json');

/**
 * Where an in-flight move keeps the files it can touch, as they were before it — at their own paths below.
 *
 * @param {string} target - The project.
 * @returns {string}
 */
export const movedFrom = (target) => join(target, HARNESS, 'upgrade-saved');

/**
 * The move a project was left in when `upgrade --apply` was stopped before it finished, or null when none is.
 *
 * A pin that moved with the composed files half-written looks like hand edits to every check, and the
 * owner's own edits it was about to put back lived only in the stopped process's memory. This is what says
 * so instead, and what `nina upgrade --abort` undoes it from.
 *
 * @param {string} target - The project.
 * @returns {{from: string, to: string, started: string, created: string[], saved: string[]}|{unreadable: string}|null}
 */
export function interruptedMove(target) {
  try {
    return JSON.parse(readFileSync(moveJournal(target), 'utf8'));
  } catch (error) {
    return error.code === 'ENOENT' ? null : { unreadable: error.message };
  }
}

/**
 * A stopped move, said once for every command that finds one.
 *
 * @param {NonNullable<ReturnType<typeof interruptedMove>>} stopped - The move.
 * @returns {string}
 */
export function describeMove(stopped) {
  return stopped.unreadable
    ? `An upgrade was stopped before it finished, and its journal ${HARNESS}/upgrade.json cannot be read (${stopped.unreadable}).`
    : `An upgrade from ${stopped.from} to ${stopped.to}, started ${stopped.started}, was stopped before it finished — the pin and the composed files may be half-moved.`;
}
