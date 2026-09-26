/**
 * The snapshot, sent to Langfuse: each dispatch a trace, grouped by its session, and each verdict a score.
 *
 * `stats` and `learn` read the snapshot on a terminal. Langfuse reads the same records in a UI that
 * filters, groups and charts them, and keeps them beside anything else a project sends it. What is sent
 * is metadata — role, verdict, timings, tokens, the model, the estimated cost, how many issues a loop-back
 * named and how many files a run wrote — and not the description the orchestrator gave the dispatch: each
 * span is built field by field, so nothing reaches Langfuse that is not named here.
 *
 * A dispatch is a trace rather than a span in one trace per session, because a stage is what gets read:
 * its trace is named for its role, filtered by it, and scored; the session id puts a pipeline's stages
 * side by side in Langfuse's sessions view.
 *
 * Observations go over OpenTelemetry (`/api/public/otel/v1/traces`, OTLP/HTTP as JSON), the path
 * Langfuse's v4 data model takes, with the session and trace attributes on every span, as its guide asks.
 * Verdicts go to `/api/public/scores` as categorical scores. Langfuse keeps what it was first sent: the
 * same span id sent again is a second observation, not an update, and every sum counts both; a score is
 * replaced only when its id, name and date all match, and that endpoint takes no date — it stamps the
 * day it is called. So each is sent once, and only for a run that has settled. No dependency: `fetch`
 * is enough.
 */

import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { TEXT_CHARS, TOOL_CHARS, clip, redact } from './agentrun.mjs';
import { costOf } from './prices.mjs';

/** Where Langfuse runs when the environment names no host: its EU cloud. */
export const DEFAULT_HOST = 'https://cloud.langfuse.com';

/** Spans per request. OTLP takes large batches; a smaller one leaves less in doubt when a request fails. */
export const BATCH = 100;

/**
 * How long after a run returns it is taken to be finished. The snapshot fills a record in after the fact —
 * a verdict read from a resumed run, tokens from a transcript that grew — and a span cannot be changed
 * once sent, so it waits. Most runs are final when they return; a run resumed later is the exception,
 * and the export says how many changed after they went.
 */
export const SETTLE_MINUTES = 15;

/** How long a run that never returned is waited for before it is sent as it is. */
export const UNRETURNED_HOURS = 24;

/** A stable hex id of a given length, from what it identifies. */
const hexId = (text, length) => createHash('sha256').update(String(text)).digest('hex').slice(0, length);

/** The trace a dispatch becomes, and the observation at its root. */
export const traceIdOf = (record) => hexId(`trace|${record.dispatch_id}`, 32);
export const spanIdOf = (record) => hexId(record.dispatch_id, 16);

/** An ISO time, as OTLP's nanoseconds since the epoch — a string, since it outgrows a double. */
const nanos = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `${BigInt(ms) * 1_000_000n}` : null;
};

/** One OTLP attribute: whole numbers as ints, arrays as arrays of strings, the rest as strings. */
const attribute = (key, value) => ({
  key,
  value: Array.isArray(value)
    ? { arrayValue: { values: value.map((v) => ({ stringValue: String(v) })) } }
    : typeof value === 'number' && Number.isInteger(value)
      ? { intValue: String(value) }
      : { stringValue: String(value) },
});

/**
 * Whether a run is finished enough to send: `SETTLE_MINUTES` after it returned, or `UNRETURNED_HOURS`
 * after it was dispatched when it never did.
 *
 * @param {object} record - A snapshot record.
 * @param {Date} [now]
 * @returns {boolean}
 */
export function settled(record, now = new Date()) {
  const returned = Date.parse(record.result_ts);
  if (Number.isFinite(returned)) return now.getTime() - returned >= SETTLE_MINUTES * 60_000;
  const dispatched = Date.parse(record.ts);
  return Number.isFinite(dispatched) && now.getTime() - dispatched >= UNRETURNED_HOURS * 3_600_000;
}

/** The usage and estimated cost attributes of a generation, from its tokens. */
function usageAttributes(tokens, model, priced) {
  const cost = costOf(tokens, priced);
  const out = [];
  if (model) out.push(attribute('langfuse.observation.model.name', model));
  out.push(
    attribute(
      'langfuse.observation.usage_details',
      JSON.stringify({
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        cache_read_input_tokens: tokens.read ?? 0,
        cache_creation_input_tokens: (tokens.write_5m ?? 0) + (tokens.write_1h ?? 0),
      }),
    ),
  );
  if (cost !== null) out.push(attribute('langfuse.observation.cost_details', JSON.stringify({ total: Number(cost.toFixed(6)) })));
  return out;
}

/**
 * How much of a stage's context a project sends, from its switch in the Langfuse configuration: all of it
 * (`--content`), only what passed between the agents (`--prompts`), or none.
 *
 * @param {{content?: boolean|string}|undefined} setting - The project's entry, if it is on.
 * @returns {'full'|'prompts'|null}
 */
export function contextMode(setting) {
  return setting?.content === 'prompts' ? 'prompts' : setting?.content ? 'full' : null;
}

/** A round's shape, as metadata on its root: how many turns and calls it took, and how large its context and prompt were. */
const SHAPE = ['turns', 'tool_calls', 'context_start', 'context_peak', 'prompt_chars'];

/**
 * The OTLP span at the root of a dispatch's trace. Without its context, a run that spent tokens is a
 * generation carrying the run's whole usage and estimated cost, and one that did not is a span. With it,
 * the root is the agent — its prompt in, its report out — and the usage is on the messages beneath it,
 * so no sum counts a token twice. With the prompt and report alone, nothing is beneath it, so the root is
 * a generation again, carrying the usage beside them. Its verdict is the score beside it rather than an
 * attribute on it: a run whose verdict is read only later can still be given one, since that is a first
 * score and not a second span.
 *
 * @param {object} record - A snapshot record.
 * @param {string} project - The name the project goes by in Langfuse.
 * @param {{prompt: string, report: string}} [context] - What the stage was given and handed back.
 * @param {{usage?: boolean}} [options] - `usage`: the root carries the usage even with its context.
 * @returns {object|null} Null for a record with no time to place it at.
 */
export function spanOf(record, project, context = null, { usage = false } = {}) {
  const start = nanos(record.ts);
  if (!start) return null;
  const end = nanos(record.result_ts) ?? start;
  const tokens = (!context || usage) && record.tokens && typeof record.tokens === 'object' ? record.tokens : null;
  const attributes = [
    attribute('langfuse.session.id', record.session ?? 'no-session'),
    attribute('langfuse.trace.name', record.role),
    attribute('langfuse.trace.tags', ['nina', project]),
    attribute('langfuse.trace.metadata.project', project),
    attribute('langfuse.trace.metadata.role', record.role),
    attribute('langfuse.observation.type', tokens ? 'generation' : context ? 'agent' : 'span'),
    attribute('langfuse.observation.metadata.role', record.role),
  ];
  if (typeof record.issues === 'number') attributes.push(attribute('langfuse.observation.metadata.issues', record.issues));
  if (typeof record.files_touched === 'number') attributes.push(attribute('langfuse.observation.metadata.files_touched', record.files_touched));
  if (record.branch) attributes.push(attribute('langfuse.observation.metadata.branch', record.branch));
  if (record.effort) attributes.push(attribute('langfuse.observation.metadata.effort', record.effort));
  // A round after the first is the same agent resumed after it reported; the trace says which.
  if (typeof record.round === 'number') attributes.push(attribute('langfuse.observation.metadata.round', record.round));
  for (const key of SHAPE) if (typeof record[key] === 'number') attributes.push(attribute(`langfuse.observation.metadata.${key}`, record[key]));
  if (tokens) attributes.push(...usageAttributes(tokens, record.usage_model, record.usage_model));
  if (context) {
    attributes.push(attribute('langfuse.observation.input', context.prompt ?? ''));
    attributes.push(attribute('langfuse.observation.output', context.report ?? ''));
  }
  return { traceId: traceIdOf(record), spanId: spanIdOf(record), name: record.role, kind: 1, startTimeUnixNano: start, endTimeUnixNano: end, attributes };
}

/**
 * Everything a dispatch sends: the root, and — when its context goes too — a generation per message it
 * wrote, with that message's own tokens and cost, and an observation per tool it called, with what went
 * in and what came back. With `prompts`, only what passed between the agents goes: the root, with the
 * prompt the stage was given and the report it handed back, and none of what it read, wrote or called in
 * between. Every text is masked (`redact`), cut to a length, and has the owner's home directory written
 * as `~`.
 *
 * @param {object} record - A snapshot record.
 * @param {string} project - The name the project goes by in Langfuse.
 * @param {object|null} run - From `readRun`, or null to send the record alone.
 * @param {{text?: number, tool?: number}} [limits] - How much of each text goes.
 * @param {{prompts?: boolean}} [options] - `prompts`: the prompt and the report, and nothing beneath them.
 * @returns {object[]} Spans; empty for a record with no time to place it at.
 */
export function spansOf(record, project, run, limits = {}, { prompts = false } = {}) {
  const textChars = limits.text ?? TEXT_CHARS;
  const toolChars = limits.tool ?? TOOL_CHARS;
  const home = homedir();
  const clean = (text, chars) => clip(redact(String(text ?? '')).replaceAll(home, '~'), chars);
  const root = spanOf(record, project, run ? { prompt: clean(run.prompt, textChars), report: clean(run.report, textChars) } : null, { usage: prompts });
  if (!root) return [];
  if (!run || prompts) return [root];
  const child = (id, name, start, end, attributes) => ({
    traceId: root.traceId,
    spanId: hexId(`${record.dispatch_id}|${id}`, 16),
    parentSpanId: root.spanId,
    name,
    kind: 1,
    startTimeUnixNano: nanos(start) ?? root.startTimeUnixNano,
    endTimeUnixNano: nanos(end) ?? nanos(start) ?? root.startTimeUnixNano,
    attributes: [attribute('langfuse.session.id', record.session ?? 'no-session'), ...attributes],
  });
  const messages = run.messages.map((m) =>
    child(m.id, m.model ?? 'message', m.start, m.end, [
      attribute('langfuse.observation.type', 'generation'),
      attribute('langfuse.observation.output', clean(m.text.join('\n\n'), textChars)),
      ...(m.tokens ? usageAttributes(m.tokens, m.model, m.priced) : []),
    ]),
  );
  const tools = run.tools.map((c) =>
    child(c.id, c.name, c.start, c.end, [
      attribute('langfuse.observation.type', 'tool'),
      attribute('langfuse.observation.input', clean(JSON.stringify(c.input ?? null), toolChars)),
      attribute('langfuse.observation.output', clean(c.output, toolChars)),
      ...(c.error ? [attribute('langfuse.observation.level', 'ERROR')] : []),
    ]),
  );
  return [root, ...messages, ...tools];
}

/**
 * The categorical score a verdict becomes, or null for a run with none. Its id is derived from the
 * dispatch, so the same verdict is recognisable as the same score wherever it is looked at.
 *
 * @param {object} record - A snapshot record.
 * @returns {object|null}
 */
export function scoreOf(record) {
  if (!record.verdict || record.verdict === 'UNCLEAR' || record.verdict === 'NONE') return null;
  return {
    id: hexId(`${record.dispatch_id}|verdict`, 32),
    traceId: traceIdOf(record),
    observationId: spanIdOf(record),
    name: 'verdict',
    value: record.verdict,
    dataType: 'CATEGORICAL',
    metadata: { verdict_source: record.verdict_source ?? 'none' },
  };
}

/** The OTLP request body for a batch of spans. */
export function otlpBody(spans) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', 'nina')] },
        scopeSpans: [{ scope: { name: 'nina' }, spans }],
      },
    ],
  };
}

/**
 * How long one request may take. A host that stops answering would otherwise hold the export forever —
 * and the export holds its project's lock, so every later one would find it taken and send nothing. A
 * request cut off after Langfuse took it is the one way a span goes twice, so a batch of spans, the one
 * request that carries real weight, gets the longer wait.
 */
export const REQUEST_MS = 30_000;
export const SPANS_MS = 120_000;

/** The headers every request carries. */
const headersFor = ({ publicKey, secretKey }) => ({
  Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
  'Content-Type': 'application/json',
});

/** A request that did not succeed, said in one line — its status and the start of what came back. */
async function failure(response, what) {
  const body = await response.text().catch(() => '');
  return `the ${what} endpoint answered ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`;
}

/**
 * Sends one batch of spans. OTLP can answer 200 and still reject part of a batch, in a `partialSuccess`
 * that counts the spans refused without naming them — so a batch is either not taken at all, or taken,
 * possibly with some of it refused, and which of its spans Langfuse kept cannot be known.
 *
 * @param {object[]} spans - OTLP spans, from `spanOf`.
 * @param {{host: string, publicKey: string, secretKey: string, fetch?: typeof fetch}} target
 * @returns {Promise<{taken: boolean, error: string|null}>} `taken` when the request was accepted, and
 *   `error` when anything in it was not.
 */
export async function postSpans(spans, target) {
  const request = target.fetch ?? fetch;
  try {
    const response = await request(`${target.host.replace(/\/+$/, '')}/api/public/otel/v1/traces`, {
      method: 'POST',
      headers: { ...headersFor(target), 'x-langfuse-ingestion-version': '4' },
      body: JSON.stringify(otlpBody(spans)),
      signal: AbortSignal.timeout(SPANS_MS),
    });
    if (!response.ok) return { taken: false, error: await failure(response, 'traces') };
    let partial = null;
    try {
      partial = JSON.parse(await response.text())?.partialSuccess ?? null;
    } catch {
      // An empty or non-JSON body on a 2xx is an acceptance with nothing to add.
    }
    const refused = Number(partial?.rejectedSpans ?? 0);
    return refused > 0
      ? { taken: true, error: `Langfuse refused ${refused} of ${spans.length} span(s) in a batch it took${partial.errorMessage ? ` — ${String(partial.errorMessage).slice(0, 200)}` : ''}` }
      : { taken: true, error: null };
  } catch (error) {
    return { taken: false, error: `the traces endpoint could not be reached — ${error.message}` };
  }
}

/**
 * Sends one score.
 *
 * @param {object} score - From `scoreOf`.
 * @param {{host: string, publicKey: string, secretKey: string, fetch?: typeof fetch}} target
 * @returns {Promise<string|null>} Null when Langfuse accepted it; otherwise why not.
 */
export async function postScore(score, target) {
  const request = target.fetch ?? fetch;
  try {
    const response = await request(`${target.host.replace(/\/+$/, '')}/api/public/scores`, {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify(score),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    return response.ok ? null : await failure(response, 'scores');
  } catch (error) {
    return `the scores endpoint could not be reached — ${error.message}`;
  }
}

/**
 * Sends scores in batches, as `score-create` events to `/api/public/ingestion`. The scores endpoint takes
 * one per request and sits in Langfuse's general API bucket, 30 requests a minute on the free plan, so a
 * first export's few hundred verdicts would be refused after thirty. The batched endpoint is deprecated
 * for everything else but keeps taking score events past November 2026, in the tracing bucket. It answers
 * per event, so a score it refused is known by name.
 *
 * @param {object[]} scores - From `scoreOf`.
 * @param {{host: string, publicKey: string, secretKey: string, fetch?: typeof fetch}} target
 * @returns {Promise<{taken: Set<string>, error: string|null, gone: boolean}>} The ids of the scores taken;
 *   `gone` when the endpoint is no longer there, so the caller can send them one by one instead.
 */
export async function postScores(scores, target) {
  const request = target.fetch ?? fetch;
  const events = scores.map((score) => ({ id: randomUUID(), timestamp: new Date().toISOString(), type: 'score-create', body: score }));
  const byEvent = new Map(events.map((e) => [e.id, e.body.id]));
  try {
    const response = await request(`${target.host.replace(/\/+$/, '')}/api/public/ingestion`, {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify({ batch: events }),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    if (!response.ok) return { taken: new Set(), error: await failure(response, 'ingestion'), gone: response.status === 404 || response.status === 410 };
    // Taken unless named among the errors: a score sent again on another day is a second score, so a 2xx
    // that lists nothing is read as having taken everything rather than as having taken nothing.
    let answer = {};
    try {
      answer = JSON.parse(await response.text());
    } catch {
      // A 2xx with no body to read took the batch.
    }
    const refused = Array.isArray(answer.errors) ? answer.errors : [];
    const out = new Set(refused.map((e) => e.id));
    const taken = new Set(events.filter((e) => !out.has(e.id)).map((e) => byEvent.get(e.id)));
    return { taken, error: refused.length ? `Langfuse refused ${refused.length} score(s) — ${String(refused[0].message ?? refused[0].status).slice(0, 200)}` : null, gone: false };
  } catch (error) {
    return { taken: new Set(), error: `the ingestion endpoint could not be reached — ${error.message}`, gone: false };
  }
}

/**
 * Whether a pair of keys opens a Langfuse project, and which: the one read the keys are good for.
 *
 * @param {{host: string, publicKey: string, secretKey: string, fetch?: typeof fetch}} target
 * @returns {Promise<{project: string|null, error: string|null}>}
 */
export async function projectOf(target) {
  const request = target.fetch ?? fetch;
  try {
    const response = await request(`${target.host.replace(/\/+$/, '')}/api/public/projects`, { headers: headersFor(target), signal: AbortSignal.timeout(REQUEST_MS) });
    if (!response.ok) return { project: null, error: await failure(response, 'projects') };
    const body = JSON.parse(await response.text());
    return { project: body?.data?.[0]?.name ?? '(unnamed)', error: null };
  } catch (error) {
    return { project: null, error: `${target.host} could not be reached — ${error.message}` };
  }
}
