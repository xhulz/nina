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
 *   node scripts/harness-check.mjs --hook     JSON for a Stop hook — shown to the person; always exit 0
 *   node scripts/harness-check.mjs --context  JSON for a UserPromptSubmit hook — read by the model
 *                                             before it answers; always exit 0
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
        args: ['compose', '--check', '--drift', '--quiet'],
        hint: 'these files are generated — run `nina where <file>` to see which layer owns it, then `nina compose`',
        ignore: /^compose: current$/,
      },
      // What the project has not declared yet: vocabulary, its own layer, the documents the layers
      // read, the wiring. On a new project this is the whole to-do list, and it reaches the model
      // before its first answer — so the first conversation starts by filling it, unasked.
      {
        name: 'declaration',
        bin: 'nina',
        args: ['check', '--detector', '--quiet'],
        hint: 'each line says what is missing — `.nina/TODO.md` lists the project’s own items, and `.nina/BRIEF.md`, where the interview wrote one, says what the project is; fill them, then `nina compose`',
        ignore: /^check: declaration is sound/,
      },
      // The one link of the learning cycle that fails in silence: a role keeps being sent back
      // and nothing is written down. It fires on the event — three loop-backs since that role's
      // newest lesson — not on a rate, so it says something new when it speaks. A lesson learned
      // a third time it sends to the harness itself, and says so once.
      {
        name: 'lessons',
        bin: 'nina',
        args: ['learn', '--check', '--quiet'],
        hint: 'each line above says what it needs — `nina learn` shows the whole cycle',
        ignore: /^learn: current$/,
      },
      // The loop gate holds the caps in .claude/graph.md from this project's hooks, and it lets every
      // call through when it fails — so a gate that stopped working looks exactly like a pipeline with
      // no loops. This asks it, every turn, whether it is wired and would still hold one.
      {
        name: 'loop gate',
        bin: 'nina',
        args: ['gate', '--selftest', '--quiet'],
        hint: 'the caps in .claude/graph.md are not being held — `nina wire --apply` wires the gate; `nina gate --selftest` says what else is wrong',
        ignore: /^gate: current$/,
      },
<!-- nina:slot project.1 detectors -->
    ],
    { root: ROOT, hook: process.argv.includes('--hook'), context: process.argv.includes('--context') },
  ),
);
