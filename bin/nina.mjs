#!/usr/bin/env node
/**
 * NINA — composes an agent harness into a project, keeps it wired and current, and measures what the
 * pipeline it composed does. Each command lives in `src/commands/`; this file is the table of them, and
 * the one place an argument is checked before any command runs.
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
import { status } from '../src/commands/status.mjs';

/** The NINA install directory (the parent of `bin/`). */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where a command acts, which most of them take. */
const PROJECT = { '--project <dir>': 'the project to act on (default: the working directory)' };

/**
 * Commands wired today, in the order `help` lists them, each with what it takes: `options`, keyed by the
 * option and the name of its value when it takes one, and `args`, what it takes that is not an option.
 * Checked before the command runs, and printed by `nina <command> --help`.
 */
const COMMANDS = {
  init: {
    run: init,
    help: 'start a harness for a project: profile, surfaces, and what to fill',
    options: {
      ...PROJECT,
      '--surfaces <list>': 'declare the surfaces, comma-separated, instead of detecting them',
      '--core <version>': 'the release to pin (default: the newest this install carries)',
      '--force': 'start over, keeping the pin, the vocabulary and the integrations the profile declares',
      '--ask': 'ask about the surfaces even when not on a terminal',
      '--no-ask': 'take the detected surfaces without asking',
    },
  },
  status: {
    run: status,
    help: "one screen: the pin, the install and the newest release, the hooks, the gate, check, what the week cost, the learning",
    options: { ...PROJECT, '--offline': 'do not ask the registry for the newest release' },
  },
  snapshot: {
    run: snapshot,
    help: 'capture pipeline history from the Claude Code transcripts',
    options: {
      '--project <name>': 'only the projects whose name contains this',
      '--exact': 'only the project named exactly so',
      '--out <dir>': 'where to write (default: ~/.nina/snapshots)',
      '--rebuild': 'read every transcript again from the start, keeping a copy of what it replaces',
    },
  },
  stats: {
    run: stats,
    help: 'report loop-back rate per stage from the snapshots',
    options: {
      '--project <name>': 'the project whose history to read (default: the one here)',
      '--all': 'every project on this machine',
      '--since <date>': 'from this day on, YYYY-MM-DD',
      '--snapshots <dir>': 'read the history from somewhere else',
    },
  },
  runs: {
    run: runs,
    help: 'what each piece of work cost: its cycles, their stages and rounds, what was sent back, time and cost',
    options: { ...PROJECT, '--since <date>': 'from this day on, YYYY-MM-DD', '--last <n>': 'how many cycles (default: 10)' },
  },
  check: {
    run: check,
    help: "validate a project's profile, vocabulary and integrations",
    options: {
      ...PROJECT,
      '--detector': 'as the project\'s harness:check runs it',
      '--expect-unfilled <slots>': 'slots, comma-separated, a move is known to leave unfilled',
    },
  },
  compose: {
    run: compose,
    help: "rebuild a project's harness files from the core, its surfaces and its own layer",
    options: {
      ...PROJECT,
      '--check': 'report drift instead of writing',
      '--drift': 'with --check: only whether the files on disk are what the layers compose',
      '--expect-unfilled <slots>': 'slots, comma-separated, a move is known to leave unfilled',
    },
  },
  where: { run: where, help: 'say which layer owns a path, and where a change to it goes', args: '<path>', options: PROJECT },
  pipeline: {
    run: pipeline,
    help: "draw the project's agent chain: the line, its gates, what goes back, each stage's model and skills",
    options: { ...PROJECT, '--for <shape>': 'the chain for one task shape, by number or words', '--since <date>': 'history from this day on, YYYY-MM-DD' },
  },
  pills: { run: pills, help: 'validate the corrections the pipeline wrote about itself', options: { ...PROJECT, '--tidy': 'move retired pills to .claude/pills/retired/' } },
  learn: {
    run: learn,
    help: 'is the pipeline learning from its own runs? observe, capture, apply, graduate, verify; --deep reads why',
    options: {
      ...PROJECT,
      '--check': 'as a detector: say only what is owed',
      '--days <n>': 'how far back to look',
      '--graduate <pill>': 'send a lesson to the harness as a request',
      '--close <request>': 'close a request whose rule reached this project some other way',
      '--deep': 'have a model read why the pipeline sent work back',
      '--dry-run': 'with --deep: say what would be read, and read nothing',
      '--model <id>': 'with --deep: the model that reads',
      '--api': 'with --deep: bill the API instead of the Claude Code login',
    },
  },
  requests: {
    run: requests,
    help: "the lessons projects have graduated to the harness — this repo's inbox",
    options: {
      '--check': 'as a detector: say only what is waiting',
      '--answer <id>': 'record the rule a request became',
      '--in <file>': 'with --answer: the layer file that now carries it',
      '--decline <id>': 'record that a request does not become a rule',
      '--why <reason>': 'with --decline: why',
    },
  },
  wire: {
    run: wire,
    help: "merge the hooks and npm scripts a project's harness needs to run",
    options: { ...PROJECT, '--to <version>': 'wire for this release instead of the pinned one', '--apply': 'write them, instead of printing them' },
  },
  gate: {
    run: gate,
    help: 'the loop gate: is it wired, and would it still hold a loop past its cap?',
    options: { ...PROJECT, '--selftest': 'hold a synthetic loop past its cap, and compare the ledger with the history', '--hook': 'answer one hook event on stdin' },
  },
  upgrade: {
    run: upgrade,
    help: 'move a project to a newer core, reporting what it costs',
    options: {
      ...PROJECT,
      '--to <version>': 'the core to move to',
      '--apply': 'make the move, once it is safe, and verify it',
      '--force': 'move although something would lose meaning',
      '--abort': 'undo a move that was stopped before it finished',
    },
  },
  eval: {
    run: evalCommand,
    help: "does a release's reviewer catch more planted defects than another's? runs on the login",
    options: {
      '--release <version>': 'a release to measure; give two to compare them',
      '--repeat <n>': 'runs per release',
      '--model <id>': 'the model the reviewer runs on',
      '--judge': 'have a model grade each finding against the planted defects',
      '--api': 'bill the API instead of the Claude Code login',
      '--dry-run': 'say what would run, and run nothing',
      '--keep': 'keep the scratch projects',
      '--reports <dir>': 'keep each report here',
      '--regrade <dir>': 'grade reports kept earlier instead of running',
    },
  },
  export: {
    run: exportCommand,
    help: 'send the measured history to Langfuse by hand: each run once',
    options: {
      '--langfuse': 'the destination — the only one there is',
      '--project <name>': 'one project, by its snapshot name',
      '--dry-run': 'say what would be sent, and send nothing',
      '--auto': 'as the hook runs it after a turn',
    },
  },
  langfuse: {
    run: langfuse,
    help: 'keep the Langfuse keys, and turn on the projects that send their runs after every turn',
    args: '<login|on|off|status>',
    options: {
      ...PROJECT,
      '--host <url>': 'with login: the Langfuse host',
      '--content': 'with on: send what each stage read, wrote and called',
      '--prompts': 'with on: send only what passed between the agents',
    },
  },
  release: { run: release, help: 'freeze the working core + surfaces as a pinnable version', args: '<version>', options: {} },
};

/** Options every command takes: the banner reads it, and the commands that print say less. */
const EVERYWHERE = { '--quiet': 'say nothing unless something is wrong, and print no banner' };

/** Prints the commands. */
function help() {
  console.log('  usage: nina <command> [options]        nina <command> --help for its options');
  console.log('         nina              on a terminal: the banner once, then type commands under it\n');
  for (const [name, c] of Object.entries(COMMANDS)) {
    console.log(`    ${name.padEnd(12)} ${c.help}`);
  }
  console.log('');
}

/** Prints one command's usage and options. */
function commandHelp(name) {
  const c = COMMANDS[name];
  const options = { ...c.options, ...EVERYWHERE };
  console.log(`  usage: nina ${name}${c.args ? ` ${c.args}` : ''} [options]\n`);
  console.log(`  ${c.help}\n`);
  const width = Math.max(...Object.keys(options).map((k) => k.length));
  for (const [option, what] of Object.entries(options)) console.log(`    ${option.padEnd(width)}  ${what}`);
  console.log('');
}

/**
 * What is wrong with a command's arguments, or null. An option the command does not take was ignored, so
 * `compose --chek` composed over the tree it was meant to check; an option's value was taken on trust, so
 * `--project --quiet` named a directory called `--quiet`, and a `--project` with nothing after it crashed.
 *
 * @param {string} name - The command.
 * @param {string[]} argv - Its arguments.
 * @returns {string|null}
 */
function refusal(name, argv) {
  const c = COMMANDS[name];
  const takes = new Map(Object.keys({ ...c.options, ...EVERYWHERE }).map((k) => [k.split(' ')[0], k.includes(' ')]));
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('-')) {
      positional.push(a);
      continue;
    }
    if (!takes.has(a)) return `${name} takes no option ${a}`;
    if (takes.get(a)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) return `${a} needs a value`;
      i += 1;
    }
  }
  const allowed = c.args ? 1 : 0;
  if (positional.length > allowed) return `${name} takes ${allowed === 0 ? 'no argument' : `one argument, ${c.args}`}, and was given ${positional.slice(allowed).join(' ')}`;
  return null;
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
    if (name === 'help' && COMMANDS[argv[0]]) commandHelp(argv[0]);
    else help();
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    console.error(`  unknown command "${name}" — see \`nina help\`.\n`);
    return 2;
  }
  // Before anything runs: `nina init --help` used to initialise the working directory.
  if (argv.includes('--help') || argv.includes('-h')) {
    commandHelp(name);
    return 0;
  }
  const wrong = refusal(name, argv);
  if (wrong) {
    console.error(`  ${wrong} — \`nina ${name} --help\` lists what it takes. Nothing was run.\n`);
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
