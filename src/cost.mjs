/**
 * The cost watch: tells a subagent, while it runs, what its own context has come to cost.
 *
 * What a run spends is mostly its context read again: every turn re-reads everything the run has built,
 * so its cost grows faster than its work. Over the first new project's first days, three quarters of the
 * implementer's spend was cache read, a median 36M tokens a round and 159M at most, and nothing said so
 * until `stats` read the transcripts afterwards. This runs on every tool call a subagent makes — Claude Code
 * hands a PostToolUse hook's `additionalContext` to the subagent that made the call — and, each time the
 * tokens its run has re-read cross a threshold and then each doubling of it, tells the run what each turn
 * now costs and what to do about it, and tells the person in one line.
 *
 * It reads only what the run's transcript gained since its last call, keeps counts per message and
 * nothing else, under the project's gate directory, and lets every call through if anything goes wrong.
 *
 * Two things a run pays for on every turn after are settled at the call itself. A shell command's long
 * output stays in the context and is re-read on every turn — outputs longer than a screen were a fifth of
 * what two projects' stages re-read — so past `clipAt` characters it goes to a file beside the ones Claude
 * Code keeps for the session, and the run sees its first and last lines and where the rest is. And a call
 * that ran past the five minutes a subagent's cache lives makes the next turn write the whole context again,
 * at twelve times a read's price — a quarter of what one project's stages spent — so the run is told then.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectGateDir } from './gate.mjs';
import { CLIP_MARK } from './transcripts.mjs';

/** Where a run's counts are kept between calls, one file per agent. */
const stateDir = (root) => join(projectGateDir(root), 'cost');

/** Runs' counts are dropped this long after their last call: a run does not come back after a week. */
const KEEP_MS = 7 * 86_400_000;

/**
 * Reads what a file gained after an offset, up to its last complete line.
 *
 * @param {string} path - The transcript.
 * @param {number} from - The offset already read.
 * @returns {{text: string, to: number}}
 */
function gained(path, from) {
  const size = statSync(path).size;
  if (size <= from) return { text: '', to: size < from ? 0 : from };
  const buffer = Buffer.alloc(size - from);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, buffer.length, from);
  } finally {
    closeSync(fd);
  }
  const end = buffer.lastIndexOf(0x0a);
  if (end === -1) return { text: '', to: from };
  return { text: buffer.subarray(0, end + 1).toString('utf8'), to: from + end + 1 };
}

/** How long a subagent's prompt cache lives without a turn: a call that runs past it is paid for again in full. */
const CACHE_MS = 5 * 60_000;

/**
 * Whether a shell command reads a file or a diff rather than producing output: what it prints is what the
 * run asked to read, so clipping it would only send the run to read the file it was cut to. What a command
 * line prints last is its last command's, and of a pipe its last stage's, so that is the one judged:
 * `sed -i … && node run` produces output, and `cd p && cat f` or `node run && tail -n 50 log` reads.
 *
 * @param {unknown} command - The Bash call's command.
 * @returns {boolean}
 */
export function readsByShell(command) {
  if (typeof command !== 'string') return false;
  const last = command
    .split(/&&|\|\||;|\n/)
    .map((s) => s.trim().replace(/^\(+|\)+$/g, '').trim())
    .filter((s) => s && !/^(\w+=\S*\s*)+$/.test(s))
    .at(-1);
  const words = (last ?? '')
    .split('|')
    .at(-1)
    .trim()
    // Less what runs a command rather than being it: assignments, `export`, `timeout`, `nice`, `command`.
    .replace(/^((\w+=\S*|export\s+\w+=\S*|timeout\s+\S+|nice|command)\s+)+/, '');
  return /^(cat|sed|head|tail|nl|awk|less|more)(\s|$)/.test(words) || /^git(\s+(-C\s+\S+|--no-pager|-c\s+\S+))*\s+(diff|show)\b/.test(words);
}

/**
 * The first lines of a text up to a size, or its last ones; a single line longer than the size is cut.
 *
 * @param {string} text - The output.
 * @param {number} size - Characters at most.
 * @param {boolean} fromEnd - The last lines rather than the first.
 * @returns {string}
 */
function lines(text, size, fromEnd) {
  const all = text.split('\n');
  const kept = [];
  let length = 0;
  for (const line of fromEnd ? all.reverse() : all) {
    if (length + line.length + 1 > size) break;
    kept.push(line);
    length += line.length + 1;
  }
  if (kept.length === 0) return fromEnd ? text.slice(-size) : text.slice(0, size);
  return (fromEnd ? kept.reverse() : kept).join('\n');
}

/**
 * A long Bash output clipped: the whole of it written to a file in the session's `tool-results` directory,
 * where Claude Code keeps the outputs it moves out itself and a stage may read, and in its place the first
 * lines, the last ones — where a test runner or a battery prints its summary — and where the rest is.
 * Null when the output is short, the command reads a file, or the file cannot be written: the run then sees
 * the output as it was.
 *
 * @param {object} input - The PostToolUse hook's input.
 * @param {number} clipAt - The characters past which an output is clipped; 0 clips nothing.
 * @returns {{updatedToolOutput: object, chars: number}|null}
 */
export function clipOutput(input, clipAt) {
  const response = input?.tool_response;
  if (input?.tool_name !== 'Bash' || !(clipAt > 0) || response === null || typeof response !== 'object' || typeof response.stdout !== 'string') return null;
  const stderr = typeof response.stderr === 'string' ? response.stderr : '';
  const chars = response.stdout.length + stderr.length;
  if (chars <= clipAt || response.isImage || readsByShell(input.tool_input?.command)) return null;
  const id = /^[A-Za-z0-9_-]{1,80}$/.test(String(input.tool_use_id ?? '')) ? input.tool_use_id : `${Date.now()}`;
  const file = join(dirname(input.transcript_path), input.session_id, 'tool-results', `nina-${id}.txt`);
  const whole = stderr ? `${response.stdout}\n--- stderr ---\n${stderr}` : response.stdout;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, whole);
  } catch {
    return null;
  }
  const said =
    `${CLIP_MARK}: ${whole.split('\n').length.toLocaleString('en-US')} lines and ${chars.toLocaleString('en-US')} characters, of which the first and last lines are shown. ` +
    `The whole of it${stderr ? ', stderr after stdout,' : ''} is in ${file} — grep it, or read the range you need: read whole, it all comes back into your context and is re-read on every turn after.]`;
  // A stdout short enough to show whole is shown once, the notice after it: only what is long is cut.
  const head = Math.round(clipAt / 8);
  const tail = Math.round((clipAt * 3) / 8);
  const stdout = response.stdout.length > head + tail ? `${lines(response.stdout, head, false)}\n…\n${said}\n…\n${lines(response.stdout, tail, true)}` : `${response.stdout}\n${said}`;
  return {
    chars,
    updatedToolOutput: { ...response, stdout, stderr: stderr ? lines(stderr, head, true) : stderr },
  };
}

/**
 * What one call of the watch says, or null: the counts are brought up to date from the run's transcript,
 * and a warning is due each time the total re-read crosses `warnAt`, then twice it, four times it, and on.
 * A long Bash output is clipped to a file ({@link clipOutput}), and a call that outlived the cache is named.
 *
 * @param {object} input - The PostToolUse hook's input.
 * @param {{root: string, warnAt: number, clipAt?: number, now?: number}} options
 * @returns {object|null} The hook's answer.
 */
export function watch(input, { root, warnAt, clipAt = 0, now = Date.now() }) {
  // Only inside a subagent, which is where `agent_id` is set; and an id that could not be a file name is not one.
  if (input?.hook_event_name !== 'PostToolUse' || !/^[A-Za-z0-9_-]{1,64}$/.test(String(input.agent_id ?? ''))) return null;
  // The session's id becomes a directory name below, in the clip's path and the transcript's.
  if (typeof input.transcript_path !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(String(input.session_id ?? ''))) return null;
  const clipped = clipOutput(input, clipAt);
  const counted = warnAt > 0 ? count(input, { root, warnAt, now }) : null;
  const ran = typeof input.duration_ms === 'number' && input.duration_ms > CACHE_MS ? input.duration_ms : null;
  if (!clipped && !counted?.due && ran === null) return null;
  const size = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
  const context = [];
  const person = [];
  if (counted?.due) {
    context.push(
      `NINA cost watch: this run has re-read ${counted.total} tokens of its own context${counted.turn}; every further turn costs more than the last. ` +
        'If what is left is more than one run should carry, stop where your work is whole, hand back what you have, and name what is left, so the orchestrator can send it as its own step. Otherwise finish without widening the work.',
    );
    person.push(`${input.agent_type ?? 'a subagent'} ${input.agent_id.slice(0, 8)} has re-read ${counted.total} tokens of its own context${counted.turn}.`);
  }
  if (ran !== null) {
    const minutes = Math.round(ran / 60_000);
    const whole = counted?.context ? `, about ${size(counted.context)} tokens,` : '';
    context.push(
      `NINA cost watch: that call ran ${minutes} minutes, past the five your context stays cached between turns, so your next turn writes all of it${whole} again — at twelve times what re-reading it costs. ` +
        'Wait in calls that each end within three minutes: run the rest in shares, or start it in the background and check on it no more often than every three minutes (Hard Rule #19).',
    );
    person.push(`${input.agent_type ?? 'a subagent'} ${input.agent_id.slice(0, 8)} waited ${minutes} min in one call; its next turn writes its whole context again.`);
  }
  return {
    ...(person.length ? { systemMessage: `NINA: ${person.join(' ')}` } : {}),
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      ...(context.length ? { additionalContext: context.join('\n\n') } : {}),
      ...(clipped ? { updatedToolOutput: clipped.updatedToolOutput } : {}),
    },
  };
}

/**
 * The run's re-read brought up to date from its transcript, and whether a warning is due; null when the
 * transcript is not there.
 *
 * @param {object} input - The PostToolUse hook's input.
 * @param {{root: string, warnAt: number, now: number}} options
 * @returns {{due: boolean, total: string, turn: string, context: number|null}|null}
 */
function count(input, { root, warnAt, now }) {
  const transcript = join(dirname(input.transcript_path), input.session_id, 'subagents', `agent-${input.agent_id}.jsonl`);
  if (!existsSync(transcript)) return null;
  const dir = stateDir(root);
  const file = join(dir, `${input.agent_id}.json`);
  let state = { offset: 0, read: {}, warned: 0 };
  try {
    state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // A run's first call, or its counts lost: read its transcript from the start.
  }
  const { text, to } = gained(transcript, state.offset);
  let last = null;
  const n = (v) => (typeof v === 'number' ? v : 0);
  for (const line of text.split('\n')) {
    if (!line.includes('"cache_read_input_tokens"')) continue;
    try {
      const message = JSON.parse(line)?.message;
      const read = message?.usage?.cache_read_input_tokens;
      // A streamed message is written once per content block under one id: its last copy counts.
      if (message?.id && typeof read === 'number') {
        state.read[message.id] = read;
        last = read;
        // The whole context that turn held, which a turn after an expired cache writes again.
        state.context = read + n(message.usage.cache_creation_input_tokens) + n(message.usage.input_tokens);
      }
    } catch {
      // A torn line loses one message's count.
    }
  }
  state.offset = to;
  state.at = now;
  const total = Object.values(state.read).reduce((a, b) => a + b, 0);
  let crossed = state.warned;
  while (total >= warnAt * 2 ** crossed) crossed += 1;
  const due = crossed > state.warned;
  state.warned = crossed;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(state));
  const size = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1000)}k`);
  return {
    due,
    total: `${Math.round(total / 1e6)}M`,
    turn: last === null ? '' : `, and each turn now re-reads about ${size(last)} tokens more`,
    context: typeof state.context === 'number' ? state.context : null,
  };
}

/** Drops the counts of runs not heard from in a week. */
function prune(root, now) {
  const dir = stateDir(root);
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    try {
      if (now - statSync(join(dir, name)).mtimeMs > KEEP_MS) rmSync(join(dir, name), { force: true });
    } catch {
      // Another call's, going as this one looks.
    }
  }
}

/**
 * The hook: reads the event from stdin, answers on stdout when a warning is due or an output is clipped,
 * and exits 0 whatever happens — a hook that fails must not stop the run it watches.
 *
 * @param {{root: string, warnAt: number, clipAt?: number, stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream}} options
 * @returns {Promise<number>}
 */
export async function runCostWatch({ root, warnAt, clipAt = 0, stdin = process.stdin, stdout = process.stdout }) {
  try {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const now = Date.now();
    const answer = watch(JSON.parse(Buffer.concat(chunks).toString('utf8')), { root, warnAt, clipAt, now });
    if (answer) stdout.write(`${JSON.stringify(answer)}\n`);
    if (Math.random() < 0.01) prune(root, now);
  } catch {
    // Fails open: the run goes on unwatched.
  }
  return 0;
}
