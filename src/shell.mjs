/**
 * `nina` with no command, on a terminal: the banner once, then a prompt that runs commands under it.
 *
 * Every command prints the banner, and it stays that way — see `src/banner.mjs`. Run one after another,
 * that put six lines of art between every two answers, and the owner asked for what Claude Code does: the
 * name once at the top of a session, and the work below it. Each command still runs as its own process,
 * exactly as it does from the shell, so nothing a command does to the process — an exit code, a change
 * of directory, an interview that reads the terminal — can leave the session in a state the next command
 * inherits. The session only tells it to leave the banner out.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { PINK, printBanner, useColor } from './banner.mjs';
import { shellHistoryFile } from './paths.mjs';

/** Words the session answers itself rather than handing to a command. */
const LEAVE = new Set(['exit', 'quit', 'q']);

/** The most commands kept for the arrow keys. */
const HISTORY = 500;

/**
 * Splits a typed line into arguments the way a shell would for what these commands take: words, and
 * quoted strings that keep their spaces.
 *
 * @param {string} line - What was typed.
 * @returns {string[]}
 */
export function words(line) {
  const out = [];
  let word = null;
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) word += line[(i += 1)];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= '';
    } else if (/\s/.test(c)) {
      if (word !== null) out.push(word);
      word = null;
    } else if (c === '\\' && i + 1 < line.length) {
      word = (word ?? '') + line[(i += 1)];
    } else {
      word = (word ?? '') + c;
    }
  }
  if (word !== null) out.push(word);
  return out;
}

/**
 * The commands typed in earlier sessions, newest first, as readline takes them.
 *
 * @returns {string[]}
 */
function pastCommands() {
  try {
    return readFileSync(shellHistoryFile(), 'utf8').split('\n').filter(Boolean).slice(-HISTORY).reverse();
  } catch {
    return [];
  }
}

/** Keeps one command for the next session; a history that cannot be written costs only the arrow keys. */
function keep(line) {
  try {
    mkdirSync(dirname(shellHistoryFile()), { recursive: true });
    appendFileSync(shellHistoryFile(), `${line}\n`);
  } catch {
    // The session goes on without it.
  }
}

/**
 * Runs the session until `exit`, Ctrl-D, or Ctrl-C twice on an empty line.
 *
 * @param {{bin: string, version: string, commands: string[]}} options - The CLI to run each command
 *   with, its version for the banner, and the command names, for Tab.
 * @returns {Promise<number>} Process exit code.
 */
export function shell({ bin, version, commands }) {
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const dim = (s) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s);
  const prompt = useColor() ? `\x1b[38;2;${PINK.join(';')}mnina ›\x1b[0m ` : 'nina › ';

  printBanner(version);
  console.log(dim('  type a command — stats, check, upgrade --to <version> — `help` lists them, `clear` starts the screen over, `exit` leaves\n'));

  const names = [...commands, 'help', 'clear', 'exit'];
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt,
    terminal,
    history: terminal ? pastCommands() : [],
    historySize: HISTORY,
    removeHistoryDuplicates: true,
    completer: (line) => {
      const typed = words(line);
      if (typed.length > 1 || /\s$/.test(line)) return [[], line];
      const hits = names.filter((n) => n.startsWith(typed[0] ?? ''));
      return [hits.length ? hits : names, line];
    },
  });

  // A command interrupted with Ctrl-C takes the signal; the session, which receives it too, stays.
  const stay = () => {};
  process.on('SIGINT', stay);

  // Ctrl-C clears what was typed; on an empty line it says how to leave, and a second one leaves.
  let interrupted = false;
  rl.on('SIGINT', () => {
    if (rl.line.length > 0) {
      interrupted = false;
      rl.write(null, { ctrl: true, name: 'u' });
      return;
    }
    if (interrupted) {
      rl.close();
      return;
    }
    interrupted = true;
    process.stdout.write(`\n${dim('  (Ctrl-C again, or exit, to leave)')}\n`);
    rl.prompt();
  });

  // Closed, the session reads nothing more: Node 24 goes on handing over the lines already read after
  // `exit`, and the first of them ran a command and then prompted on a closed interface.
  let closed = false;
  return new Promise((done) => {
    rl.on('line', (line) => {
      if (closed) return;
      interrupted = false;
      const typed = words(line);
      // Typed out of habit, the way it is run from the shell.
      if (typed[0] === 'nina') typed.shift();
      if (typed.length === 0) {
        rl.prompt();
        return;
      }
      if (terminal) keep(line.trim());
      if (LEAVE.has(typed[0])) {
        rl.close();
        return;
      }
      if (typed[0] === 'clear') {
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        printBanner(version);
        rl.prompt();
        return;
      }

      // The command owns the terminal while it runs: line editing back to the terminal's, and its
      // stdin the session's own, so an interview can read it. Piped input stays the session's.
      if (terminal) process.stdin.setRawMode(false);
      const run = spawnSync(process.execPath, [bin, ...typed], {
        stdio: [terminal ? 'inherit' : 'ignore', 'inherit', 'inherit'],
        env: { ...process.env, NINA_SHELL: '1' },
      });
      if (terminal) process.stdin.setRawMode(true);
      if (run.status) console.log(dim(`  exit ${run.status}`));
      else if (run.signal) console.log(dim(`  stopped (${run.signal})`));
      process.stdout.write('\n');
      rl.prompt();
    });
    rl.on('close', () => {
      closed = true;
      process.removeListener('SIGINT', stay);
      if (terminal) process.stdout.write('\n');
      done(0);
    });
    rl.prompt();
  });
}
