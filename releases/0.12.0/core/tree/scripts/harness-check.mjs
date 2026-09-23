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
<!-- nina:slot project.1 detectors -->
    ],
    { root: ROOT, hook: process.argv.includes('--hook') },
  ),
);
