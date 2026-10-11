/**
 * `nina dashboard` — the office, the tasks, the pipeline, the pills, the learning cycle and the stats in one page on
 * this machine, its address printed for a click (src/dashboard.mjs).
 *
 *   nina dashboard [--project <dir>] [--port <n>] [--open]
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HARNESS } from '../paths.mjs';
import { viewDashboard } from '../dashboard.mjs';

/**
 * Runs the command.
 *
 * @param {string[]} argv
 * @param {{root: string}} ctx - CLI context.
 * @returns {Promise<number>} Process exit code.
 */
export async function dashboard(argv, ctx) {
  const arg = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] ?? '' : null);
  const target = resolve(arg('--project') ?? '.');
  if (!existsSync(join(target, HARNESS, 'profile.json'))) {
    console.error(`  no ${HARNESS}/profile.json under ${target} — run it inside a project, or name one with --project\n`);
    return 1;
  }
  const port = arg('--port');
  if (port !== null && !(/^\d+$/.test(port) && Number(port) <= 65535)) {
    console.error(`  --port takes a port number, 0 to 65535, and was given ${port}\n`);
    return 2;
  }
  return viewDashboard({ target, ctx, port: port === null ? undefined : Number(port), open: argv.includes('--open') });
}
