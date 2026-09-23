#!/usr/bin/env node
/**
 * Runs this project's harness drift detectors.
 *
 * The mechanism lives in the NINA package — what counts as drift, what counts as a check
 * that could not run, and how either reaches a Claude Code hook. Only the LIST is here,
 * because only this project knows which detectors it has and what to do when one fires.
 *
 * Usage:
 *   node scripts/harness-check.mjs            human-readable; exit 1 on drift, 2 on error
 *   node scripts/harness-check.mjs --hook     JSON for a Claude Code hook; always exit 0
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDetectors } from '@xhulz/nina/detectors';

const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));

process.exit(
  runDetectors(
    [
      // Every composed project has this one, so the core carries it rather than asking each
      // project to write the same nine lines. It disables itself where the project does not
      // declare the npm script, like any other detector.
      {
        name: 'agent specs',
        declaredBy: 'harness:compose:check',
        bin: 'nina',
        args: ['compose', '--check', '--quiet'],
        hint: 'these files are generated — run `nina where <file>` to see which layer owns it, then `nina compose`',
        ignore: /^compose: current$/,
      },
      // The one link of the learning cycle that fails in silence: a role keeps being sent back
      // and nothing is written down. It fires on the event — three loop-backs since that role's
      // newest lesson — not on a rate, so it says something new when it speaks.
      {
        name: 'lessons',
        bin: 'nina',
        args: ['learn', '--check', '--quiet'],
        hint: 'write the lesson as a pill, or bump `occurrences` and `last_seen` on the one that already says it — `nina learn` shows the cycle',
        ignore: /^learn: current$/,
      },
<!-- nina:slot project.1 detectors -->
    ],
    { root: ROOT, hook: process.argv.includes('--hook') },
  ),
);
