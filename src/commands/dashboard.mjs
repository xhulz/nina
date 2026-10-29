/**
 * `nina dashboard` — the office, the tasks, the pipeline, the pills, the learning cycle and the stats in one page on
 * this machine, its address printed for a click (src/dashboard.mjs).
 *
 *   nina dashboard [--project <dir>] [--port <n>] [--open]
 *   nina dashboard --demo [--port <n>] [--open]      an invented project, anywhere, its office playing in a loop
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HARNESS } from '../paths.mjs';
import { viewDashboard } from '../dashboard.mjs';
import { makeDemo } from '../demo.mjs';

/**
 * Runs the command.
 *
 * @param {string[]} argv
 * @param {{root: string}} ctx - CLI context.
 * @returns {Promise<number>} Process exit code.
 */
export async function dashboard(argv, ctx) {
  const arg = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] ?? '' : null);
  const port = arg('--port');
  if (port !== null && !(/^\d+$/.test(port) && Number(port) <= 65535)) {
    console.error(`  --port takes a port number, 0 to 65535, and was given ${port}\n`);
    return 2;
  }
  const options = { ctx, port: port === null ? undefined : Number(port), open: argv.includes('--open') };
  if (argv.includes('--demo')) {
    if (arg('--project') !== null) {
      console.error('  --demo shows an invented project, so it takes no --project: give one or the other\n');
      return 2;
    }
    let demo;
    try {
      demo = await makeDemo(ctx);
    } catch (error) {
      console.error(`  the demo could not be made — ${error?.message ?? error}\n`);
      return 1;
    }
    // Removed however the process ends; on Ctrl+C, once the dashboard has closed. A terminal closed under it hangs it up,
    // which ends the process with no `exit` event unless something listens.
    process.once('exit', demo.remove);
    process.once('SIGHUP', () => process.exit(129));
    try {
      return await viewDashboard({ ...options, target: demo.project, demo: true });
    } finally {
      demo.remove();
    }
  }
  const target = resolve(arg('--project') ?? '.');
  if (!existsSync(join(target, HARNESS, 'profile.json'))) {
    console.error(`  no ${HARNESS}/profile.json under ${target} — run it inside a project, or name one with --project, or see one with --demo\n`);
    return 1;
  }
  return viewDashboard({ ...options, target });
}
