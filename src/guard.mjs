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
import { composedPaths } from './commands/compose.mjs';
import { HARNESS } from './paths.mjs';

/** The package this runs from: its releases say whether a pinned version ships the guard. */
const PACKAGE = dirname(dirname(fileURLToPath(import.meta.url)));

/** The tools that change a file, and where each names it. */
const EDITS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

/**
 * How far into a file the notice is looked for: below a frontmatter block, or a shebang. The compose
 * suite holds every composed file's notice inside it.
 */
export const NOTICE_HEAD = 60;

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
export function pinnedLayers(root, pkg = PACKAGE) {
  try {
    const profile = JSON.parse(readFileSync(join(root, HARNESS, 'profile.json'), 'utf8'));
    if (typeof profile.core !== 'string' || !/^[A-Za-z0-9._-]+$/.test(profile.core)) return null;
    const layers = profile.core === 'dev' ? pkg : join(pkg, 'releases', profile.core);
    if (!existsSync(join(layers, 'core', 'tree', 'scripts', 'edit-guard.mjs'))) return null;
    return { layers, surfaces: Array.isArray(profile.surfaces) ? profile.surfaces : [] };
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
 * A composed file's notice, as one sentence without its comment syntax, or null when it has none.
 *
 * @param {string} text - The file.
 * @returns {string|null}
 */
export function noticeOf(text) {
  const lines = String(text).split('\n').slice(0, NOTICE_HEAD);
  const at = lines.findIndex((l) => /^(<!--|\/\/) nina:generated/.test(l));
  if (at < 0) return null;
  const block = [];
  if (lines[at].startsWith('//')) {
    for (const line of lines.slice(at)) {
      if (!line.startsWith('//')) break;
      block.push(line.replace(/^\/\/ ?/, ''));
    }
  } else {
    for (const line of lines.slice(at)) {
      block.push(line.replace(/^<!-- /, '').replace(/ ?-->$/, ''));
      if (line.includes('-->')) break;
    }
  }
  return block.map((l) => l.trim()).join(' ');
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
    const key = EDITS[input.tool_name];
    const path = key ? input.tool_input?.[key] : null;
    const pinned = typeof path === 'string' ? pinnedLayers(root, pkg) : null;
    if (!pinned) return null;
    const target = isAbsolute(path) ? path : resolve(input.cwd ?? root, path);
    if (!existsSync(target)) return null;
    const rel = relative(realpathSync(root), realpathSync(target)).split(sep).join('/');
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
