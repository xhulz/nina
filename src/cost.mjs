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
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectGateDir } from './gate.mjs';

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

/**
 * What one call of the watch says, or null: the counts are brought up to date from the run's transcript,
 * and a warning is due each time the total re-read crosses `warnAt`, then twice it, four times it, and on.
 *
 * @param {object} input - The PostToolUse hook's input.
 * @param {{root: string, warnAt: number, now?: number}} options
 * @returns {object|null} The hook's answer.
 */
export function watch(input, { root, warnAt, now = Date.now() }) {
  // Only inside a subagent, which is where `agent_id` is set; and an id that could not be a file name is not one.
  if (input?.hook_event_name !== 'PostToolUse' || !/^[A-Za-z0-9_-]{1,64}$/.test(String(input.agent_id ?? ''))) return null;
  if (typeof input.transcript_path !== 'string' || typeof input.session_id !== 'string' || !(warnAt > 0)) return null;
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
  for (const line of text.split('\n')) {
    if (!line.includes('"cache_read_input_tokens"')) continue;
    try {
      const message = JSON.parse(line)?.message;
      const read = message?.usage?.cache_read_input_tokens;
      // A streamed message is written once per content block under one id: its last copy counts.
      if (message?.id && typeof read === 'number') {
        state.read[message.id] = read;
        last = read;
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
  if (!due) return null;
  const m = (n) => `${Math.round(n / 1e6)}M`;
  const size = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
  const turn = last === null ? '' : `, and each turn now re-reads about ${size(last)} tokens more`;
  return {
    systemMessage: `NINA: ${input.agent_type ?? 'a subagent'} ${input.agent_id.slice(0, 8)} has re-read ${m(total)} tokens of its own context${turn}.`,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `NINA cost watch: this run has re-read ${m(total)} tokens of its own context${turn}; every further turn costs more than the last. ` +
        'If what is left is more than one run should carry, stop where your work is whole, hand back what you have, and name what is left, so the orchestrator can send it as its own step. Otherwise finish without widening the work.',
    },
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
 * The hook: reads the event from stdin, answers on stdout when a warning is due, and exits 0 whatever
 * happens — a hook that fails must not stop the run it watches.
 *
 * @param {{root: string, warnAt: number, stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream}} options
 * @returns {Promise<number>}
 */
export async function runCostWatch({ root, warnAt, stdin = process.stdin, stdout = process.stdout }) {
  try {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const now = Date.now();
    const answer = watch(JSON.parse(Buffer.concat(chunks).toString('utf8')), { root, warnAt, now });
    if (answer) stdout.write(`${JSON.stringify(answer)}\n`);
    if (Math.random() < 0.01) prune(root, now);
  } catch {
    // Fails open: the run goes on unwatched.
  }
  return 0;
}
