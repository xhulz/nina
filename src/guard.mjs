/**
 * The edit guard: a composed file is changed in its layer, never in place.
 *
 * Every composed file opens with a `nina:generated` notice naming the layer to edit instead, and it
 * reached every edit of a file that already exists — `Edit` refuses a file it has not read. But reaching
 * is not stopping: an agent that read the notice and edited anyway was found only after the turn, as
 * drift, and the next compose wrote over its work. This runs on `PreToolUse` for the edit tools and
 * refuses an edit to a file carrying the notice, with the notice itself as the reason, so the refusal
 * says where the change goes.
 *
 * It denies rather than asks. The loop gate asks because it cannot be sure two rounds are the same
 * issue; here nothing is uncertain — the file says it is generated, and the compose that follows any
 * hand edit undoes it. What it does not reach is stated rather than hidden: a file written through the
 * shell (`sed -i`, a heredoc), and a composed path that does not exist yet.
 *
 * It fails open, and only acts where the pinned version ships it: a composed script outlives the version
 * that composed it, and hooks run whatever is on disk.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTICE_HEAD, composedPaths, noticeOf } from './commands/compose.mjs';
import { HARNESS, layerRootFor, readProfile } from './paths.mjs';

// Read here and by the suites from here; the test itself lives beside the compiler that writes the notice.
export { NOTICE_HEAD, noticeOf };

/** The package this runs from: its releases say whether a pinned version ships the guard. */
const PACKAGE = dirname(dirname(fileURLToPath(import.meta.url)));

/** The tools that change a file, and where each names it. */
const EDITS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

/** The git subcommands that move the checkout or write its history — Hard Rule #18's. */
const MOVES = new Set(['stash', 'checkout', 'switch', 'reset', 'restore', 'clean', 'commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'apply', 'pull', 'push']);

/** Words before the command word that leave it the command: `env X=1 git …`, `command git …`, `{ git …; }`. */
const RUNNERS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'nice', '{', '}', '!']);

/** A `-C` or a `cd` to one of these is still the tree the stage was dispatched into. */
const HERE = new Set(['.', './']);

/** Where a heredoc's delimiter word ends. */
const DELIMITER_ENDS = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '`', '<', '>']);

/** The characters that can end a run of plain word characters. */
const SPECIAL = new Set(["'", '"', '\\', '#', '\n', '<', '&', ';', '|', '(', ')', '`', ' ', '\t', '\r']);

/**
 * A shell command as the shell reads it: its simple commands, in order, each as its words with the quotes removed.
 * `&&`, `||`, `;`, `|`, `&`, a newline, a parenthesis and a backquote end one; a quoted string is part of a word — `"git" stash`
 * is git — and never a separator or a command of its own, across lines too; a comment and a heredoc's body are not
 * read. One pass, no pattern: the command is a model's, and a pattern that backtracks on it is one a stage could
 * stall the guard with.
 *
 * @param {string} command
 * @returns {string[][]}
 */
function simpleCommands(command) {
  const text = String(command);
  const commands = [[]];
  const heredocs = [];
  let word = null;
  const end = () => {
    if (word !== null) commands.at(-1).push(word);
    word = null;
  };
  const next = () => {
    end();
    if (commands.at(-1).length) commands.push([]);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      const stop = close === -1 ? text.length : close;
      word = (word ?? '') + text.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === '"') {
      const parts = [];
      i += 1;
      let from = i;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          parts.push(text.slice(from, i));
          from = i + 1;
          i += 2;
        } else i += 1;
      }
      parts.push(text.slice(from, i));
      word = (word ?? '') + parts.join('');
      i += 1;
    } else if (c === '\\') {
      if (text[i + 1] !== '\n') word = (word ?? '') + (text[i + 1] ?? '');
      i += 2;
    } else if (c === '#' && word === null) {
      const line = text.indexOf('\n', i);
      i = line === -1 ? text.length : line;
    } else if (c === '\n') {
      next();
      i += 1;
      for (const delimiter of heredocs.splice(0)) {
        while (i < text.length) {
          const line = text.indexOf('\n', i);
          const stop = line === -1 ? text.length : line;
          const body = text.slice(i, stop);
          i = stop + 1;
          if (body.trim() === delimiter) break;
        }
      }
    } else if (c === '<' && text.startsWith('<<<', i)) {
      word = (word ?? '') + '<<<';
      i += 3;
    } else if (c === '<' && text[i + 1] === '<') {
      end();
      i += text[i + 2] === '-' ? 3 : 2;
      while (text[i] === ' ' || text[i] === '\t') i += 1;
      const from = i;
      while (i < text.length && !DELIMITER_ENDS.has(text[i])) i += 1;
      const delimiter = text.slice(from, i).replaceAll("'", '').replaceAll('"', '').replaceAll('\\', '');
      if (delimiter) heredocs.push(delimiter);
    } else if (c === '&' && (text[i + 1] === '>' || word?.endsWith('>') || word?.endsWith('<'))) {
      word = (word ?? '') + c;
      i += 1;
    } else if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '`') {
      next();
      i += (c === '&' || c === '|') && text[i + 1] === c ? 2 : 1;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      end();
      i += 1;
    } else {
      const from = i;
      i += 1;
      while (i < text.length && !SPECIAL.has(text[i])) i += 1;
      word = (word ?? '') + text.slice(from, i);
    }
  }
  end();
  return commands.filter((words) => words.length);
}

/**
 * The git subcommand in a shell command that would move the checkout the command runs in, or null. Read command
 * by command, in order, as the shell runs it: a `cd` exempts only what comes after it — `git stash && cd /tmp`
 * stashed the tree all the same, and a test of the whole string for a `cd` let it through — and `-C .` is not
 * another directory. A git command is one whose command word is `git`, not a phrase in a quoted string or a
 * heredoc's body; its subcommand is the word after its global options, so `merge-base` is not `merge`; and a
 * stash's `list` or `show`, and an `apply` that only checks, read.
 *
 * @param {string} command - A Bash tool call's command.
 * @returns {string|null}
 */
export function checkoutMove(command) {
  let moved = false;
  for (const words of simpleCommands(command)) {
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || RUNNERS.has(words[0]))) words.shift();
    if (words[0] === 'cd' || words[0] === 'pushd') {
      moved ||= !HERE.has(words[1] ?? '');
      continue;
    }
    if (words[0] !== 'git') continue;
    let i = 1;
    let elsewhere = false;
    while (words[i]?.startsWith('-')) {
      if (words[i] === '-C') {
        elsewhere ||= !HERE.has(words[i + 1] ?? '.');
        i += 2;
      } else if (words[i] === '-c') {
        i += 2;
      } else {
        if (/^--(git-dir|work-tree)\b/.test(words[i])) elsewhere = true;
        i += 1;
      }
    }
    const sub = words[i];
    if (!MOVES.has(sub) || moved || elsewhere) continue;
    const rest = words.slice(i + 1);
    if (sub === 'stash' && ['list', 'show'].includes(rest[0])) continue;
    if (sub === 'apply' && rest.some((w) => ['--check', '--stat', '--numstat', '--summary'].includes(w)) && !rest.includes('--apply')) continue;
    return sub;
  }
  return null;
}

/**
 * A stage's shell command that would move the checkout it was dispatched into, refused. Only the orchestrator
 * commits, and the work in flight lives in that tree, uncommitted: one reviewer, told not to edit, stashed it to
 * compare with the baseline, and its pop failed on a conflict.
 *
 * @param {object} input - The hook's stdin, parsed.
 * @param {{layers: string}} pinned - The pinned layers, whose hard rules say whether this one is the project's.
 * @returns {object|null}
 */
function handleShell(input, pinned) {
  if (!input.agent_id) return null;
  const moves = checkoutMove(input.tool_input?.command ?? '');
  if (!moves) return null;
  let rules = '';
  try {
    rules = readFileSync(join(pinned.layers, 'core', 'tree', 'CLAUDE.md'), 'utf8');
  } catch {
    return null;
  }
  if (!rules.includes('Only the orchestrator commits')) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `NINA: \`git ${moves}\` would move the checkout the pipeline's work in flight lives in — Hard Rule #18: only the orchestrator ` +
        'commits, and no stage moves the checkout. Read history with git diff, log, show, status or blame, and build or test another ' +
        'revision in a `git worktree` you remove afterwards.',
    },
  };
}

/** How much of a file is read to find it: the head, not the whole of a large file on every edit. */
const HEAD_BYTES = 16 * 1024;

/**
 * The layers a project pins, with its surfaces — or null when that version ships no guard, since a
 * composed script outlives the version that composed it and wired hooks run whatever is on disk.
 *
 * @param {string} root - The project directory.
 * @param {string} [pkg] - The NINA install to look in.
 * @returns {{layers: string, surfaces: string[]}|null}
 */
function pinnedLayers(root, pkg = PACKAGE) {
  try {
    const { profile } = readProfile(root);
    const layers = profile ? layerRootFor(pkg, profile.core) : { error: 'no profile' };
    if (layers.error || !existsSync(join(layers.dir, 'core', 'tree', 'scripts', 'edit-guard.mjs'))) return null;
    return { layers: layers.dir, surfaces: Array.isArray(profile.surfaces) ? profile.surfaces : [] };
  } catch {
    return null;
  }
}

/** The first bytes of a file, as text. */
function head(path) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Handles one hook event: the JSON to print, or null to let the call through. Never throws.
 *
 * A file is refused only when it carries the notice AND sits at a path the pinned version composes. The
 * notice alone said too much: the integration template is composed with one and meant to be copied —
 * `.claude/integrations/<slug>.md` is the project's to write — so every copy was refused as composed,
 * with a reason naming no slot, and the only way left to edit the project's own doc was the shell. The
 * path makes the guard agree with `nina where`.
 *
 * @param {object} input - The hook's stdin, parsed.
 * @param {{root: string, pkg?: string}} options - The project, and the NINA install whose releases say
 *   whether its pin ships the guard.
 * @returns {Promise<object|null>}
 */
export async function handleEdit(input, { root, pkg = PACKAGE }) {
  try {
    if (input?.hook_event_name !== 'PreToolUse') return null;
    if (input.tool_name === 'Bash') {
      const pinnedShell = input.agent_id ? pinnedLayers(root, pkg) : null;
      return pinnedShell ? handleShell(input, pinnedShell) : null;
    }
    const key = EDITS[input.tool_name];
    const path = key ? input.tool_input?.[key] : null;
    const pinned = typeof path === 'string' ? pinnedLayers(root, pkg) : null;
    if (!pinned) return null;
    const target = isAbsolute(path) ? path : resolve(input.cwd ?? root, path);
    if (!existsSync(target)) return null;
    // The native call returns the name as it is on disk: where case is ignored, `claude.md` is CLAUDE.md, and
    // read as spelled it reached no composed path and let the edit through.
    const rel = relative(realpathSync.native(root), realpathSync.native(target)).split(sep).join('/');
    // Outside the project, or in its own layer — where a change to a composed file belongs.
    if (rel.startsWith('..') || isAbsolute(rel) || rel.split('/')[0] === HARNESS) return null;
    const notice = noticeOf(head(target));
    if (!notice || !(await composedPaths(pinned.layers, pinned.surfaces)).has(rel)) return null;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `NINA edit guard: ${rel} is composed, and the next compose would overwrite this edit — ${notice}`,
      },
    };
  } catch {
    return null;
  }
}

/**
 * The hook entry point: reads one event from stdin and prints the answer, if there is one. Always exits 0.
 *
 * @param {{root: string, stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream}} options
 * @returns {Promise<number>}
 */
export async function runGuard({ root, stdin = process.stdin, stdout = process.stdout }) {
  const chunks = [];
  try {
    for await (const chunk of stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const answer = await handleEdit(JSON.parse(Buffer.concat(chunks).toString('utf8')), { root });
    if (answer) stdout.write(`${JSON.stringify(answer)}\n`);
  } catch {
    // Unreadable input lets the call through: a guard that could block work on its own crash would be worse.
  }
  return 0;
}
