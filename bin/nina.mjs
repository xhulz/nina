#!/usr/bin/env node
/**
 * NINA — harness orchestration CLI.
 *
 * Today it captures and reports how the agent pipeline behaves. The composition
 * commands (`init`, `compose`, `check`, `upgrade`) land once the core has been
 * extracted from its first real project.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printBanner } from '../src/banner.mjs';
import { shell } from '../src/shell.mjs';
import { snapshot } from '../src/commands/snapshot.mjs';
import { compose } from '../src/commands/compose.mjs';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { pills } from '../src/commands/pills.mjs';
import { release } from '../src/commands/release.mjs';
import { upgrade } from '../src/commands/upgrade.mjs';
import { where } from '../src/commands/where.mjs';
import { learn, requests } from '../src/commands/learn.mjs';
import { stats } from '../src/commands/stats.mjs';
import { gate } from '../src/commands/gate.mjs';
import { wire } from '../src/commands/wire.mjs';
import { evalCommand } from '../src/commands/eval.mjs';
import { exportCommand } from '../src/commands/export.mjs';
import { langfuse } from '../src/commands/langfuse.mjs';
import { pipeline } from '../src/commands/pipeline.mjs';
import { runs } from '../src/commands/runs.mjs';

/** The NINA install directory (the parent of `bin/`). */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Commands wired today, in the order `help` lists them. */
const COMMANDS = {
  init: { run: init, help: 'start a harness for a project: profile, surfaces, and what to fill' },
  snapshot: { run: snapshot, help: 'capture pipeline history from the Claude Code transcripts' },
  stats: { run: stats, help: 'report loop-back rate per stage from the snapshots' },
  runs: { run: runs, help: 'what each piece of work cost: its cycles, their stages and rounds, what was sent back, time and cost' },
  check: { run: check, help: "validate a project's profile, vocabulary and integrations" },
  compose: { run: compose, help: 'rebuild a project\'s .claude/ from core + its surfaces' },
  where: { run: where, help: 'say which layer owns a path, and where a change to it goes' },
  pipeline: { run: pipeline, help: "draw the project's agent chain: the line, its gates, what goes back, each stage's model and skills" },
  pills: { run: pills, help: 'validate the corrections the pipeline wrote about itself' },
  learn: { run: learn, help: 'is the pipeline learning from its own runs? observe, capture, apply, graduate, verify; --deep reads why' },
  requests: { run: requests, help: "the lessons projects have graduated to the harness — this repo's inbox" },
  wire: { run: wire, help: "merge the hooks and npm scripts a project's harness needs to run" },
  gate: { run: gate, help: 'the loop gate: is it wired, and would it still hold a loop past its cap?' },
  upgrade: { run: upgrade, help: 'move a project to a newer core, reporting what it costs' },
  eval: { run: evalCommand, help: "does a release's reviewer catch more planted defects than another's? runs on the login" },
  export: { run: exportCommand, help: 'send the measured history to Langfuse by hand: each run once' },
  langfuse: { run: langfuse, help: 'keep the Langfuse keys, and turn on the projects that send their runs after every turn' },
  release: { run: release, help: 'freeze the working core + surfaces as a pinnable version' },
};

/** Commands named in the plan but not built yet, shown so the roadmap stays visible. */
const PLANNED = {};

/** Prints usage. */
function help() {
  console.log('  usage: nina <command> [options]');
  console.log('         nina              on a terminal: the banner once, then type commands under it\n');
  for (const [name, c] of Object.entries(COMMANDS)) {
    console.log(`    ${name.padEnd(12)} ${c.help}`);
  }
  if (Object.keys(PLANNED).length > 0) {
    console.log('\n  planned:');
    for (const [name, desc] of Object.entries(PLANNED)) {
      console.log(`    ${name.padEnd(12)} ${desc}`);
    }
  }
  console.log('\n  options:');
  console.log('    --project <dir>    the project to act on (default: the working directory)');
  console.log('    --surfaces <list>  init: declare surfaces instead of detecting them');
  console.log('    --to <version>     upgrade: the core to move to');
  console.log('    --check            compose: report drift instead of writing');
  console.log('    --quiet            compose/pills: say nothing unless something is wrong');
  console.log('    --apply            upgrade: write the new version, once it is safe');
  console.log('    --since <date>     stats: YYYY-MM-DD');
  console.log('    --snapshots <dir>  stats: read the history from somewhere else');
  console.log('    --out <dir>        snapshot: where to write\n');
}

/** Entry point. */
async function main() {
  const [, , name, ...argv] = process.argv;
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

  // On a terminal with no command, or asked for by name: one banner, then commands typed under it.
  if (name === 'shell' || (!name && process.stdin.isTTY && process.stdout.isTTY)) {
    return shell({ bin: fileURLToPath(import.meta.url), version: pkg.version, commands: Object.keys(COMMANDS) });
  }

  // A hook's stdout is its answer, and a banner in front of the JSON would make it unreadable. A command
  // typed into `nina` runs under the banner the session already printed.
  if (!argv.includes('--quiet') && !argv.includes('--hook') && !process.env.NINA_SHELL) printBanner(pkg.version);

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    help();
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    if (PLANNED[name]) {
      console.error(`  "${name}" is planned, not built yet — see \`nina help\`.\n`);
      return 2;
    }
    console.error(`  unknown command "${name}" — see \`nina help\`.\n`);
    return 2;
  }
  return command.run(argv, { root: ROOT });
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(`  ${err?.stack ?? err}`);
    process.exit(1);
  },
);
