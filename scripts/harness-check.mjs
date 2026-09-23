#!/usr/bin/env node
/**
 * Runs this repo's drift detectors.
 *
 * The mechanism — what counts as drift, what counts as a check that could not run, and how
 * either is reported to a Claude Code hook — lives in `src/detectors.mjs`, which ships in the
 * package. Only the list is here, because only this repo knows which detectors it has.
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
      {
        name: 'code map',
        declaredBy: 'code-map:check',
        script: 'scripts/code-map.mjs',
        args: ['--check', '--quiet'],
        hint: 'run `pnpm code-map` and update .claude/code-map.md',
      },
      {
        name: 'premise index',
        declaredBy: 'premise-index:check',
        script: 'scripts/premise-index.mjs',
        args: ['--check'],
        hint: 'run `pnpm premise-index`',
        ignore: /^premise indexes: current$/,
      },
      {
        name: 'agent tools',
        declaredBy: 'agent-tools:check',
        script: 'scripts/agent-tools-check.mjs',
        args: [],
        hint: 'grant the tool in the agent\'s `tools:` list, or drop the claim from its spec',
        ignore: /^agent tools: current/,
      },
      {
        name: 'cli',
        declaredBy: 'cli:test',
        script: 'scripts/cli-test.mjs',
        args: [],
        hint: 'init, check or upgrade no longer does what the test says it does',
        ignore: /^cli: ok$|^\s+✓ /,
      },
      {
        name: 'compose fixtures',
        declaredBy: 'compose:test',
        script: 'scripts/compose-test.mjs',
        args: [],
        hint: 'a fixture project no longer composes cleanly — see the failures above',
        ignore: /^compose fixtures: \d+ ok$|^\s+✓ /,
      },
    ],
    { root: ROOT, hook: process.argv.includes('--hook'), context: process.argv.includes('--context') },
  ),
);
