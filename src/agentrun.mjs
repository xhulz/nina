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
import { promptOf, roundsOf, tokensOf } from './transcripts.mjs';

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
const SECRET_NAME = /(?:secret|token(?![a-z])|passw(?:or)?d|(?:^|[_-])pass$|api[_-]?key|private[_-]?key|access[_-]?key|signing[_-]?key|credential|dsn$)/i;

/** Names that say where a secret is, or what kind, rather than holding one: `--password-file`, `TOKEN_TYPE`. */
const ABOUT_A_SECRET = /[_-](?:file|path|dir|type|count|length|size|limit|url|endpoint)$/i;

/** Token formats that are credentials on sight. */
const SECRET_TOKEN = new RegExp(
  [
    'sk-(?:ant-|lf-|proj-)?[A-Za-z0-9_-]{16,}',
    'gh[pousr]_[A-Za-z0-9]{30,}',
    'github_pat_[A-Za-z0-9_]{30,}',
    'glpat-[A-Za-z0-9_-]{20,}',
    'xox[abprs]-[A-Za-z0-9-]{10,}',
    '(?:AKIA|ASIA)[0-9A-Z]{16}',
    'AIza[0-9A-Za-z_-]{35}',
    '(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}',
    'whsec_[A-Za-z0-9+/=]{16,}',
    'npm_[A-Za-z0-9]{30,}',
    'hf_[A-Za-z0-9]{30,}',
    'SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}',
    'eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}',
  ]
    .map((p) => `\\b${p}`)
    .join('|'),
  'g',
);

/** `scheme://user:password@host` — the password, however the URL is named. */
const URL_CREDENTIAL = /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]{0,64}):[^\s@/]{1,256}@/gi;

/**
 * `NAME=value`, `NAME: value`, `"name": "value"` — the name and what joins it to a value of six characters or
 * more, and not the value: {@link redact} takes that only for a secret's name. Every part is bounded, so no
 * position costs more than a few dozen steps, whatever follows it.
 */
const ASSIGNMENT = /\b([A-Za-z0-9_-]{0,40})(["']?\s{0,3}[:=]\s{0,3}["']?)(?=[^\s"'`,;]{6})/g;

/** The value that follows an assignment, read from where {@link ASSIGNMENT} stopped. */
const VALUE = /[^\s"'`,;]+/y;

/** The same with the value in quotes, which may hold spaces: `password: "correct horse battery"`. */
const QUOTED = /\b([A-Za-z0-9_-]{1,40})(["']?\s{0,3}[:=]\s{0,3})(["'])([^"'\n]{1,256})\3/g;

/** A command-line option with its value after a space — `--password hunter2`, `--api-key "a b"`. */
const FLAG = /(--?[A-Za-z0-9][A-Za-z0-9_-]{0,40})\s{1,3}(?:(["'])([^"'\n]{1,256})\2|([^\s"'`]{3,}))/g;

/**
 * curl's and friends' `-u user:password`, quoted or not. The user has to look like one — `date -u +%H:%M`
 * is a format — and a password of digits alone is a group: `docker run -u 1000:1000`.
 */
const USER_FLAG = /((?:^|\s)(?:-u|--user)\s{1,3}[A-Za-z0-9_][A-Za-z0-9._@-]{0,63}):([^\s"']{1,256})/g;

/** The same in quotes, where the password may hold spaces. */
const USER_QUOTED = /((?:^|\s)(?:-u|--user)\s{1,3}(["'])[A-Za-z0-9_][A-Za-z0-9._@-]{0,63}):[^"'\n]{1,256}\2/g;

/** A cookie header's whole value: every cookie in it may be a session. */
const COOKIE = /\b((?:Set-)?Cookie["']?\s{0,3}:\s{0,3})[^\n"]{1,2000}/gi;

/** An `Authorization` value under any scheme, or none — `ApiKey …` and a bare token as much as `Bearer …`. */
const AUTHORIZATION = /\b((?:Proxy-)?Authorization["']?\s{0,3}[:=]\s{0,3}["']?)(?:([A-Za-z][A-Za-z0-9_-]{0,20})\s+)?[^\s"',;]{8,}/gi;

/** Whether a name and the value assigned to it make a credential. A count is not one: `max_tokens: 100000`. */
const secretPair = (name, value) => SECRET_NAME.test(name) && !ABOUT_A_SECRET.test(name) && !/^\d+$/.test(value) && value !== '[redacted]';

/**
 * Text with the secrets it obviously carries masked: private keys, the token formats of the common
 * providers, the password in a URL, an `Authorization` value, and anything assigned to a name that says it
 * is a secret. A value of digits only is left: `max_tokens: 100000` is not a credential.
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
  out = out.replace(URL_CREDENTIAL, '$1:[redacted]@');
  out = out.replace(/\b(Bearer|Basic|Token|Bot)\s+[A-Za-z0-9._~+/=-]{16,}/g, '$1 [redacted]');
  out = out.replace(AUTHORIZATION, (whole, head, scheme) => `${head}${scheme ? `${scheme} ` : ''}[redacted]`);
  out = out.replace(COOKIE, '$1[redacted]');
  out = out.replace(USER_QUOTED, (whole, head, quote) => `${head}:[redacted]${quote}`);
  out = out.replace(USER_FLAG, (whole, head, password) => (/^\d+$/.test(password) || password === '[redacted]' ? whole : `${head}:[redacted]`));
  // The shell is where most of a stage's input is written, and it passes a secret after a space.
  out = out.replace(FLAG, (whole, flag, quote, quoted, bare) =>
    secretPair(flag.replace(/^-+/, ''), quoted ?? bare) ? `${flag} ${quote ?? ''}[redacted]${quote ?? ''}` : whole,
  );
  out = out.replace(QUOTED, (whole, name, sep, quote, value) => (secretPair(name, value) ? `${name}${sep}${quote}[redacted]${quote}` : whole));
  // By hand rather than by `replace`: an assignment to a name that is not a secret's leaves its value to be
  // read, so one inside it still is. Replaced whole, `{"content":"API_KEY=…"}` took the key's value with it.
  // The value is taken once, and only for a secret's name, which keeps the whole pass linear.
  let masked = '';
  let last = 0;
  ASSIGNMENT.lastIndex = 0;
  for (let m = ASSIGNMENT.exec(out); m !== null; m = ASSIGNMENT.exec(out)) {
    const [head, name, sep] = m;
    if (!SECRET_NAME.test(name)) continue;
    VALUE.lastIndex = m.index + head.length;
    const value = VALUE.exec(out)?.[0] ?? '';
    if (!secretPair(name, value)) continue;
    masked += `${out.slice(last, m.index)}${name}${sep}[redacted]`;
    last = VALUE.lastIndex;
    ASSIGNMENT.lastIndex = last;
  }
  return masked + out.slice(last);
}

/** A tool result's text: a string, or the text blocks of a list, with images named rather than sent. */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

/**
 * Reads one round of a stage's transcript: what it was told, what it wrote and called, and what it
 * reported. A run resumed after it reported is a round per report (`roundsOf`), and a snapshot record is
 * one round, so what goes beside a record is that round's and no other's.
 *
 * @param {string} file - `agent-<id>.jsonl` under its session.
 * @param {number} [round] - Which round, from 1.
 * @returns {Promise<{prompt: string|null, report: string|null, messages: object[], tools: object[]}|null>}
 *   Null when the transcript is gone — Claude Code prunes them after a while.
 */
export async function readRun(file, round = 1) {
  if (!file || !existsSync(file)) return null;
  let prompt = null;
  let handback = null;
  let lastText = null;
  /** @type {Map<string, {id: string, model: string|null, usage: object|null, start: string, end: string, text: string[]}>} */
  const messages = new Map();
  /** @type {Map<string, {id: string, name: string, input: unknown, start: string, end: string|null, output: string, error: boolean}>} */
  const tools = new Map();
  const roundOf = roundsOf();
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const n = roundOf(line);
    if (n < round) continue;
    if (n > round) break;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // A torn line loses one entry, not the run.
    }
    const at = row.timestamp ?? null;
    const content = row.message?.content;
    if (prompt === null) prompt = promptOf(row, round);
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
