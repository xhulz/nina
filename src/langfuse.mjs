/**
 * The snapshot, sent to Langfuse: each session a trace, each dispatch an observation, each verdict a score.
 *
 * `stats` and `learn` read the snapshot on a terminal. Langfuse reads the same records in a UI that
 * filters, groups and charts them, and keeps them beside anything else a project sends it. The records
 * are metadata, and so is everything sent — role, verdict, timings, tokens, the model, the estimated cost,
 * how many issues a loop-back named and how many files a run wrote. No report text, no prompt, no source,
 * and not the description the orchestrator gave the dispatch: each span is built field by field, so
 * nothing reaches Langfuse that is not named here.
 *
 * Observations go over OpenTelemetry (`/api/public/otel/v1/traces`, OTLP/HTTP as JSON), the path
 * Langfuse's v4 data model takes, with the session and trace attributes on every span, as its guide asks.
 * Verdicts go to `/api/public/scores` as categorical scores. Langfuse keeps what it was first sent: the
 * same span id sent again is a second observation, not an update, and every sum counts both; a score is
 * replaced only when its id, name and date all match, and that endpoint takes no date — it stamps the
 * day it is called. So each is sent once, and only for a run that has settled. No dependency: `fetch`
 * is enough.
 */

import { createHash } from 'node:crypto';
import { costOf } from './prices.mjs';

/** Where Langfuse runs when the environment names no host: its EU cloud. */
export const DEFAULT_HOST = 'https://cloud.langfuse.com';

/** Spans per request. OTLP takes large batches; a smaller one leaves less in doubt when a request fails. */
export const BATCH = 100;

/**
 * How long after its last known moment a run is taken to be finished. The snapshot fills a record in
 * after the fact — a verdict read from a resumed run, tokens learned from a transcript that grew — and a
 * span cannot be changed once sent, so it waits.
 */
export const SETTLE_HOURS = 24;

/** A stable hex id of a given length, from what it identifies. */
const hexId = (text, length) => createHash('sha256').update(String(text)).digest('hex').slice(0, length);

/** The trace a session becomes, and the span a dispatch becomes. */
export const traceIdOf = (record) => hexId(`${record.project}|${record.session ?? 'no-session'}`, 32);
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
 * Whether a run is finished enough to send: its latest known moment is at least `SETTLE_HOURS` old.
 *
 * @param {object} record - A snapshot record.
 * @param {Date} [now]
 * @returns {boolean}
 */
export function settled(record, now = new Date()) {
  const last = Date.parse(record.result_ts ?? record.ts);
  return Number.isFinite(last) && now.getTime() - last >= SETTLE_HOURS * 3_600_000;
}

/**
 * The OTLP span one dispatch becomes. A run that spent tokens is a generation, with its model, usage and
 * estimated cost; one that did not is a span. Its verdict is the score beside it rather than an attribute
 * on it: a run whose verdict is read only later can still be given one, since that is a first score and
 * not a second span.
 *
 * @param {object} record - A snapshot record.
 * @param {string} project - The name the project goes by in Langfuse.
 * @returns {object|null} Null for a record with no time to place it at.
 */
export function spanOf(record, project) {
  const start = nanos(record.ts);
  if (!start) return null;
  const end = nanos(record.result_ts) ?? start;
  const tokens = record.tokens && typeof record.tokens === 'object' ? record.tokens : null;
  const cost = tokens ? costOf(tokens, record.usage_model) : null;
  const attributes = [
    attribute('langfuse.session.id', record.session ?? 'no-session'),
    attribute('langfuse.trace.name', project),
    attribute('langfuse.trace.tags', ['nina']),
    attribute('langfuse.trace.metadata.project', project),
    attribute('langfuse.observation.type', tokens ? 'generation' : 'span'),
    attribute('langfuse.observation.metadata.role', record.role),
  ];
  if (typeof record.issues === 'number') attributes.push(attribute('langfuse.observation.metadata.issues', record.issues));
  if (typeof record.files_touched === 'number') attributes.push(attribute('langfuse.observation.metadata.files_touched', record.files_touched));
  if (record.branch) attributes.push(attribute('langfuse.observation.metadata.branch', record.branch));
  if (tokens) {
    if (record.usage_model) attributes.push(attribute('langfuse.observation.model.name', record.usage_model));
    attributes.push(
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
    if (cost !== null) attributes.push(attribute('langfuse.observation.cost_details', JSON.stringify({ total: Number(cost.toFixed(6)) })));
  }
  return { traceId: traceIdOf(record), spanId: spanIdOf(record), name: record.role, kind: 1, startTimeUnixNano: start, endTimeUnixNano: end, attributes };
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
    });
    return response.ok ? null : await failure(response, 'scores');
  } catch (error) {
    return `the scores endpoint could not be reached — ${error.message}`;
  }
}
