/**
 * What one stage did, read from its own transcript: the prompt it was given, each message it wrote with
 * the tokens it spent, each tool it called with what came back, and the report it handed back.
 *
 * It exists for one reader — a project that sends its stages' context to Langfuse (`nina langfuse on
 * --content`) — and it is read at the moment of sending, never kept: the snapshot stays metadata only.
 *
 * What it reads is what the stage read, which is the project's code and anything else on disk it opened.
 * Obvious secrets are masked on the way out (`redact`), and that is a floor, not a promise: a secret that
 * looks like none of them goes as it is. That is why sending context is a switch per project.
 */

import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { tokensOf } from './transcripts.mjs';

/** How much of a prompt, a report or a message's text is sent, and of a tool call's input or result. */
export const TEXT_CHARS = 20_000;
export const TOOL_CHARS = 8_000;

/** Where a run's transcript is, from its record. */
export const runFile = (projectDir, record) =>
  record.agent_id && record.session ? join(projectDir, record.session, 'subagents', `agent-${record.agent_id}.jsonl`) : null;

/** Text cut to a length, saying how much was left out. */
export function clip(text, chars) {
  const value = String(text ?? '');
  return value.length > chars ? `${value.slice(0, chars)}… [${value.length - chars} more characters]` : value;
}

/** Names whose value is a credential when they are assigned one. */
const SECRET_NAME = /(?:secret|token|passw(?:or)?d|api_?key|private_?key|access_?key|credential)/i;

/** Token formats that are credentials on sight. */
const SECRET_TOKEN = /\b(?:sk-(?:ant-|lf-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})/g;

/** `NAME=value`, `NAME: value`, `"name": "value"` — the name bounded, so the match cannot run away. */
const ASSIGNMENT = /\b([A-Za-z0-9_]{0,40})(["']?\s{0,3}[:=]\s{0,3}["']?)([^\s"'`,;]{6,})/g;

/**
 * Text with the secrets it obviously carries masked: private keys, the token formats of the common
 * providers, an `Authorization` value, and anything assigned to a name that says it is a secret. A value
 * of digits only is left: `max_tokens: 100000` is not a credential.
 *
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  let out = String(text ?? '');
  // Private keys by position rather than by a pattern spanning lines, which is where a regex goes slow.
  for (let start = out.indexOf('-----BEGIN '); start !== -1; start = out.indexOf('-----BEGIN ', start + 1)) {
    const head = out.indexOf('-----', start + 11);
    if (head === -1 || !out.slice(start, head).includes('PRIVATE KEY')) continue;
    const end = out.indexOf('-----END ', head);
    const close = end === -1 ? -1 : out.indexOf('-----', end + 9);
    out = `${out.slice(0, start)}[redacted private key]${close === -1 ? '' : out.slice(close + 5)}`;
  }
  out = out.replace(SECRET_TOKEN, '[redacted]');
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, '$1 [redacted]');
  return out.replace(ASSIGNMENT, (whole, name, sep, value) =>
    SECRET_NAME.test(name) && !/^\d+$/.test(value) && value !== '[redacted]' ? `${name}${sep}[redacted]` : whole,
  );
}

/** A tool result's text: a string, or the text blocks of a list, with images named rather than sent. */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

/**
 * Reads a stage's transcript.
 *
 * @param {string} file - `agent-<id>.jsonl` under its session.
 * @returns {Promise<{prompt: string|null, report: string|null, messages: object[], tools: object[]}|null>}
 *   Null when the transcript is gone — Claude Code prunes them after a while.
 */
export async function readRun(file) {
  if (!file || !existsSync(file)) return null;
  let prompt = null;
  let handback = null;
  let lastText = null;
  /** @type {Map<string, {id: string, model: string|null, usage: object|null, start: string, end: string, text: string[]}>} */
  const messages = new Map();
  /** @type {Map<string, {id: string, name: string, input: unknown, start: string, end: string|null, output: string, error: boolean}>} */
  const tools = new Map();
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // A torn line loses one entry, not the run.
    }
    const at = row.timestamp ?? null;
    const content = row.message?.content;
    if (row.type === 'user' && !row.isMeta && typeof content === 'string' && prompt === null) prompt = content;
    if (row.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        const call = block?.type === 'tool_result' ? tools.get(block.tool_use_id) : null;
        if (!call) continue;
        call.output = resultText(block.content);
        call.error = block.is_error === true;
        call.end = at;
      }
    }
    if (row.type !== 'assistant' || !Array.isArray(content)) continue;
    // A streamed message is written once per content block under one id; its last row has its final usage.
    const id = row.message.id ?? row.uuid;
    const message = messages.get(id) ?? { id, model: row.message.model ?? null, usage: null, start: at, end: at, text: [] };
    message.end = at;
    if (row.message.usage) message.usage = row.message.usage;
    for (const block of content) {
      if (block?.type === 'text' && block.text.trim()) {
        message.text.push(block.text);
        lastText = block.text;
      }
      if (block?.type === 'tool_use') {
        if (block.name === 'SubagentHandback' && typeof block.input?.message === 'string') handback = block.input.message;
        tools.set(block.id, { id: block.id, name: block.name, input: block.input, start: at, end: null, output: '', error: false });
      }
    }
    messages.set(id, message);
  }
  return {
    prompt,
    report: handback ?? lastText,
    // `priced` is the model its tokens are priced at, which a fast-mode or fallback message has none of.
    messages: [...messages.values()].map((m) => {
      const { tokens, model: priced } = tokensOf(new Map([[m.id, { usage: m.usage ?? {}, model: m.model }]]));
      return { ...m, tokens, priced };
    }),
    tools: [...tools.values()],
  };
}
