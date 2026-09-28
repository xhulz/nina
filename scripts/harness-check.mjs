#!/usr/bin/env node
/**
 * Runs this repo's drift detectors: today one, the inbox of requests projects filed against the harness.
 *
 * The mechanism — what counts as drift, what counts as a check that could not run, and how
 * either is reported to a Claude Code hook — lives in `src/detectors.mjs`, which ships in the
 * package. Only the list is here, because only this repo knows which detectors it has.
 *
 * The suites are not detectors, and do not run here. They did, and the Stop hook that runs this every
 * turn gives it 30s: with the CLI suite inside it took a minute, was killed on every turn, and the inbox
 * it exists for never spoke. A request waiting is not a defect either, so it stays apart from the suites.
 *
 * Usage:
 *   node scripts/harness-check.mjs            human-readable; exit 1 on drift, 2 on error
 *   node scripts/harness-check.mjs --hook     JSON for a Claude Code hook; always exit 0
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDetectors } from '../src/detectors.mjs';

const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));

process.exit(
  runDetectors(
    [
      // The maintainer's end of graduation. A project asks for a rule by writing a request; until
      // this ran here every turn, the harness only heard about it if someone remembered to look.
      {
        name: 'requests',
        script: 'bin/nina.mjs',
        args: ['requests', '--check', '--quiet'],
        hint: 'turn each lesson into a rule in the layer it names and record it — `nina requests --answer <id> --in <layer file>`, or `--decline <id> --why …` — then cut a release; the project\'s upgrade closes it',
        ignore: /^requests: nothing waiting on the harness$/,
      },
    ],
    { root: ROOT, hook: process.argv.includes('--hook'), context: process.argv.includes('--context') },
  ),
);
