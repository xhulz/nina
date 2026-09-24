/**
 * Where NINA keeps the things that are neither the package nor a project.
 *
 * The measured pipeline history used to live inside the install directory, which only
 * worked because the install directory was a clone of this repo. Once NINA is a package
 * that is wrong twice over: a dependency is not a place to write, and under `node_modules`
 * the next install would take the history with it. The history is the user's, spans every
 * project, and losing it is irreversible — so it lives in the user's own directory.
 */

import { existsSync } from 'node:fs';
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
 * Where `nina export` keeps what it has sent, per destination and project — beside the snapshots it reads.
 *
 * @returns {string}
 */
export function exportsDir() {
  return process.env.NINA_DATA ? join(process.env.NINA_DATA, 'exports') : join(homedir(), '.nina', 'exports');
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
