/**
 * `nina pipeline --view` — the pipeline as an office seen from above, drawn in a browser page.
 *
 * Each stage of the project's composed graph has a desk, and each agent the loop gate saw launched is someone
 * sitting at one. The gate's ledger is what is read, and it holds metadata only, so the office shows who worked,
 * what they answered, the ids of the issues they named and the few words the orchestrator gave each dispatch —
 * never what an agent reported. Of a run's own transcript it reads when it was last written, how much context it
 * holds and what it is doing — the description it gave its shell command, or a tool and a file's name (`actionOf`).
 * Beside the room, a timeline of the session's tasks (`officeTimeline`), cut and named as `nina runs` cuts and names
 * them, each open one with its agents at work:
 *
 *   a dispatch                        someone sits down to work, the folder carried over by whoever handed it on
 *   a verdict                         a check over their head, or a cross when it sends work back
 *   a report nothing follows          after `HANDOFF_MS`, its agent goes home
 *   a verdict the graph sends to the  a question mark over the one who asked, until the owner speaks
 *   owner, or the orchestrator asking
 *   the gate asking at a cap          the phone on the reception's counter rings, the owner's line
 *   a pass that ends the work         a party
 *
 * The page is served from this machine alone, on the loopback address, for as long as the command runs, and its
 * address is printed for a click — opened in the system's browser only when asked. A Claude Code mod was the first
 * idea, and a probe on 2.1.294 settled it: in the editor's chat panel a mod's hooks run, its session reports no surface
 * to draw on, and no drawing is ever asked for. A mod draws in the terminal and the desktop app only. VS Code's own
 * browser opens a page only for an extension — and an extension is not NINA's to install in anyone's editor — or for
 * a click on a link, beside the conversation once `workbench.browser.openLocalhostLinks` is on (1.140).
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERMINALS, parseGraph } from './graph.mjs';
import { readLedger, sessionLedgers } from './gate.mjs';
import { readProfile, slugFor } from './paths.mjs';
import { projectStoreFile, readStoreFile } from './store.mjs';
import { CYCLE_ENDS, IN_FLIGHT, cyclesOf } from './commands/stats.mjs';
import { contextSize, isLoopBack, transcriptsOf } from './transcripts.mjs';
import { gained } from './cost.mjs';
import { shapeOf } from './commands/pipeline.mjs';
import { listenHere, openInBrowser, refuseElsewhere, untilStopped } from './serve.mjs';

/** The page, one self-contained file: the room, the sprites and the animation, with nothing fetched from anywhere. */
const PAGE = join(dirname(fileURLToPath(import.meta.url)), 'office.html');

/** The port it asks for first: NINA on a phone's keypad. Taken, any free one. */
export const OFFICE_PORT = 6462;

/**
 * How long after a pass that could end the work, without closing a task, the office waits for another dispatch
 * before it celebrates: a reviewer's approval of a spike may still go on to qa. A pass the graph sends nowhere but
 * `done` is celebrated at once.
 */
export const PARTY_QUIET_MS = 20_000;

/**
 * How long one whose report is in waits at its desk to hand its work on before it goes home. Any dispatch moves the
 * reported on, but with tasks side by side the next could be a long while coming: of two projects' 1,266 reports, 346
 * sat on past two minutes and 149 past ten, done and with nothing in hand, while Claude Code had already let them go.
 * Of 544 hand-offs, 92.8% went out within two minutes, and 93.9% within three.
 */
export const HANDOFF_MS = 2 * 60 * 1000;

/** How far back, when a live client moves to a session already running, beats still play rather than set the room. */
const SWITCH_GRACE_MS = 10_000;

/**
 * How long a run whose own transcript cannot be read may go without reporting before the office stops counting it as
 * at work: the longest of 227 runs measured across three projects took 108 minutes, and the 99th percentile 73. A run
 * that stopped without a verdict kept every later party away for the rest of its session.
 */
export const STALE_MS = 3 * 60 * 60 * 1000;

/**
 * How long a run whose transcript can be read may go without writing to it before the office stops counting it as at
 * work. Runs grew past `STALE_MS`: an implementer three hours into a step, still writing, got up from its desk and
 * left the office, and sat down again only when the orchestrator sent it a message. The longest silence inside a run,
 * in 299,030 measured across three projects, was 20 minutes — a battery waited on, a long thought.
 */
export const SILENT_MS = 45 * 60 * 1000;

/**
 * When a run with no verdict stops counting as at work: once its transcript has been quiet `SILENT_MS`, or `STALE_MS`
 * after it started when there is none to read.
 *
 * @param {{at: number}} start - The run.
 * @param {number|null} heard - When its transcript was last written, or null.
 * @returns {number}
 */
const staleAt = (start, heard) => (heard === null ? start.at + STALE_MS : Math.max(start.at, heard) + SILENT_MS);

/**
 * Each run's own transcript in a session. A run is found by its agent's id once the gate knows it, and before that — a
 * foreground run still going — by the tool_use id that launched it, which its transcript's `.meta.json` keeps.
 *
 * @param {string} target - The project directory.
 * @returns {(session: string|null) => (start: {agent: string|null, id: string|null}) => string|null}
 */
export function runFiles(target) {
  // Named as the gate names the project's ledgers, by where it really is: reached through a link, it is the same one.
  let real = target;
  try {
    real = realpathSync(target);
  } catch {
    // A project that does not exist has no transcripts either way.
  }
  /** The tool_use id each `.meta.json` names, read once: it never changes. */
  const launchedBy = new Map();
  return (session) => {
    if (!session) return () => null;
    const dir = join(transcriptsOf(slugFor(real)), session, 'subagents');
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return () => null;
    }
    const byAgent = new Map();
    const byLaunch = new Map();
    for (const name of names) {
      if (!name.startsWith('agent-')) continue;
      if (name.endsWith('.jsonl')) byAgent.set(name.slice('agent-'.length, -'.jsonl'.length), join(dir, name));
      if (!name.endsWith('.meta.json')) continue;
      const file = join(dir, `${name.slice(0, -'.meta.json'.length)}.jsonl`);
      const meta = join(dir, name);
      if (!launchedBy.has(meta)) {
        try {
          const id = JSON.parse(readFileSync(meta, 'utf8')).toolUseId;
          if (typeof id === 'string') launchedBy.set(meta, id);
        } catch {
          // Half written: read again at the next look.
        }
      }
      if (launchedBy.has(meta)) byLaunch.set(launchedBy.get(meta), file);
    }
    return (start) => (start.agent && byAgent.get(start.agent)) || (start.id && byLaunch.get(start.id)) || null;
  };
}

/**
 * When each run of a session last wrote its own transcript, so that a run still writing is at work however long it
 * takes.
 *
 * @param {(session: string|null) => (start: object) => string|null} files - Each run's transcript (`runFiles`).
 * @returns {(session: string|null) => (start: {agent: string|null, id: string|null}) => number|null}
 */
export function runClock(files) {
  return (session) => {
    const fileOf = files(session);
    const written = new Map();
    return (start) => {
      const file = fileOf(start);
      if (!file) return null;
      if (!written.has(file)) {
        try {
          written.set(file, statSync(file).mtimeMs);
        } catch {
          written.set(file, null);
        }
      }
      return written.get(file);
    };
  };
}

/** The most of a run's own words the timeline shows for what it is doing. */
const ACTION_MAX = 120;

/**
 * What a tool call is doing, in the few words a list beside the room has: the description the run gave a shell
 * command, which the run writes for a person to read, or the tool and the name of the file it works on. Never the
 * command, a path, a pattern, another tool's input or what came back.
 *
 * @param {object} block - A `tool_use` block of an assistant message.
 * @returns {string|null}
 */
export function actionOf(block) {
  if (block?.type !== 'tool_use' || typeof block.name !== 'string') return null;
  const input = block.input && typeof block.input === 'object' ? block.input : {};
  // An MCP tool is named by its server too: the tool's own name says what it does.
  const name = block.name.startsWith('mcp__') ? (block.name.split('__').filter(Boolean).at(-1) ?? block.name) : block.name;
  const said = block.name === 'Bash' && typeof input.description === 'string' ? input.description.replace(/\s+/g, ' ').trim() : '';
  if (said) return said.length > ACTION_MAX ? `${said.slice(0, ACTION_MAX - 1)}…` : said;
  const path = [input.file_path, input.notebook_path].find((x) => typeof x === 'string' && x.trim());
  // A transcript written on Windows names its files with backslashes, which a path read here does not split on.
  return path ? `${name} ${basename(path.trim().replace(/\\/g, '/'))}` : name;
}

/**
 * Each run of a session as its own transcript tells it now: how much context it holds (`contextSize` of its newest
 * message) and what it is doing (`actionOf` its newest tool call) — what Claude Code shows beside each of its running
 * agents, but for a line it writes as it watches, which it keeps nowhere. Read once a look and only what the
 * transcript gained since the last, keeping those and nothing else the run wrote; each with when its message was
 * written, so a replay is told the run as it stood at a beat.
 *
 * @param {(session: string|null) => (start: object) => string|null} files - Each run's transcript (`runFiles`).
 * @returns {(session: string|null) => (start: {agent: string|null, id: string|null}, moment?: number) => {tokens: number|null, doing: string|null}|null}
 */
export function runState(files) {
  /** By transcript, in the session last looked at: how far it was read, its last message, the counts and actions by when. */
  let read = new Map();
  let looking = null;
  return (session) => {
    // The office follows one session at a time: one it moved away from is read again if it comes back.
    if (session !== looking) read = new Map();
    looking = session;
    const fileOf = files(session);
    const looked = new Set();
    return (start, moment = Number.POSITIVE_INFINITY) => {
      const file = fileOf(start);
      if (!file) return null;
      if (!read.has(file)) read.set(file, { offset: 0, last: null, counts: [], actions: [] });
      const kept = read.get(file);
      if (!looked.has(file)) {
        looked.add(file);
        try {
          const { text, to } = gained(file, kept.offset);
          // A transcript shorter than what was read of it is another one: read again from its start.
          if (to < kept.offset) Object.assign(kept, { last: null, counts: [], actions: [] });
          kept.offset = to;
          for (const line of text.split('\n')) {
            if (!line.includes('"cache_read_input_tokens"')) continue;
            try {
              const row = JSON.parse(line);
              const at = Date.parse(row?.timestamp);
              if (!row?.message?.usage || !row.message.id || !Number.isFinite(at)) continue;
              // A message is written once for each of its blocks, with the same usage: its first is counted, and
              // each of its tool calls is a step.
              if (row.message.id !== kept.last) kept.counts.push([at, contextSize(row.message.usage)]);
              kept.last = row.message.id;
              for (const block of Array.isArray(row.message.content) ? row.message.content : []) {
                const action = actionOf(block);
                if (action) kept.actions.push([at, action]);
              }
            } catch {
              // A torn line loses one message's count; the next one has its own.
            }
          }
        } catch {
          // A transcript gone between the listing and the read tells what it had.
        }
      }
      const by = (list) => list.findLast(([at]) => at <= moment)?.[1] ?? null;
      return { tokens: by(kept.counts), doing: by(kept.actions) };
    };
  };
}

/** A wait between two of the office's looks this much longer than it asks for is the machine having slept. */
const SLEPT_MS = 60_000;

/**
 * When the machine last woke, told by the office's own looks at the ledger: one that comes long after the last, the
 * process was not running between them, and neither was any run, so a transcript's silence across it is not a run's.
 * A laptop closed for an hour with an implementer at work woke to an office that sent the implementer home before it
 * had written again.
 *
 * @param {number} [first] - The first look.
 * @returns {(now: number) => number} Given each look, the moment the machine last woke, or `-Infinity`.
 */
export function wakeClock(first = Date.now()) {
  let last = first;
  let woke = Number.NEGATIVE_INFINITY;
  return (now) => {
    if (now - last > SLEPT_MS) woke = now;
    last = now;
    return woke;
  };
}

/**
 * A dispatch the gate asked about that wrote no `dispatch` entry is taken as refused once the orchestrator launched
 * something else this long after it. A foreground run still going holds the orchestrator, so nothing else goes out;
 * dispatches sent together go out within the same moment.
 */
const REFUSED_AFTER_MS = 5000;

/** How often a live office looks at the ledger. The gate appends to it as each fact happens. */
const POLL_MS = 700;

/**
 * How long anyone was at work on a piece of work: its runs' spans joined, so runs side by side count once and a
 * night between two of them not at all — a piece begun one evening and closed the next morning was at work two hours.
 *
 * @param {{at: number, end: number|null}[]} starts - Its runs.
 * @returns {number} Milliseconds.
 */
export function busyFor(starts) {
  const spans = starts.map((s) => [s.at, Math.max(s.at, s.end ?? s.at)]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let open = null;
  for (const [from, to] of spans) {
    if (open && from <= open[1]) open[1] = Math.max(open[1], to);
    else {
      if (open) total += open[1] - open[0];
      open = [from, to];
    }
  }
  return open ? total + open[1] - open[0] : total;
}

/** The longest a replay waits between two beats, and the shortest: hours of a session play in minutes. */
const REPLAY_MAX_GAP_MS = 3000;
const REPLAY_MIN_GAP_MS = 500;

/**
 * Each run the ledger saw start, in order: when, at which stage, by which agent once known, whether it was a message
 * to a running agent, when it was refused, and when its verdict ended it. The beats and the timeline read the same.
 *
 * @param {object[]} ledger - The ledger, oldest first.
 */
function readStarts(ledger) {
  // What a session carried over from the one before it is that session's work, drawn there.
  const entries = ledger.filter((e) => Number.isFinite(Date.parse(e?.at)) && !e.inherited);
  const time = (e) => Date.parse(e.at);
  const dispatches = new Map();
  for (const e of entries) if (e.k === 'dispatch' && e.id && !dispatches.has(e.id)) dispatches.set(e.id, e);
  const announced = new Set(entries.filter((e) => e.k === 'pre' && e.id).map((e) => e.id));
  const asked = new Set(entries.filter((e) => e.k === 'ask' && e.id).map((e) => e.id));
  const startsWork = (e) => Boolean(e.role) && (e.k === 'pre' || (e.k === 'dispatch' && !(e.id && announced.has(e.id))));
  // What launched a start: its `dispatch` entry, or — until that is written — what its `pre` says of a message.
  const launchOf = (e) => (e.k === 'pre' ? (dispatches.get(e.id) ?? (e.via ? { via: e.via, agent: e.agent ?? null } : undefined)) : e);
  const verdicts = entries.filter((e) => e.k === 'verdict' && e.declared && e.agent && e.role);
  // A run the orchestrator stopped (`TaskStop`) reports nothing; read only by its verdict, it sat at its desk for
  // hours after the session had moved on, and kept the work it was part of from ending.
  const stops = entries.filter((e) => e.k === 'stop' && e.agent);

  // Each start, and how it ends: by a verdict from its agent, or from its stage while its agent is not known yet —
  // the page binds them the same way; refused, when the gate asked, no dispatch was written, and the orchestrator
  // went on to something else; or stale, a run that never reported and has gone quiet (`staleAt`).
  const starts = [];
  entries.forEach((e, i) => {
    if (!startsWork(e)) return;
    const launched = launchOf(e);
    const at = time(e);
    const ranBefore = (agent) => {
      const last = starts.findLast((s) => s.agent === agent && !s.message);
      const ended = (x) => x.agent === agent && time(x) >= last.at && time(x) <= at;
      return last && !verdicts.some(ended) && !stops.some(ended);
    };
    // A message to an agent still running adds to its run; known for certain from the dispatch, before that from
    // whether the agent it names had reported since it last started.
    const message = launched?.via === 'SendMessage' && (launched.resumed === undefined ? Boolean(launched.agent) && Boolean(ranBefore(launched.agent)) : !launched.resumed);
    const after = e.k === 'pre' && e.id && asked.has(e.id) && !dispatches.has(e.id) ? entries.slice(i + 1).find((x) => x.k === 'pre' && time(x) > at + REFUSED_AFTER_MS) : null;
    starts.push({ i, at, id: e.id ?? null, role: e.role, agent: launched?.agent ?? null, message, refusedAt: after ? time(after) : null });
  });
  const verdictOf = (s) => verdicts.find((x) => time(x) >= s.at && (s.agent ? x.agent === s.agent : x.role === s.role)) ?? null;
  for (const s of starts) {
    const verdict = verdictOf(s);
    // A stop ends the run it fell in: an agent run again after it is a run of its own, which a later stop ends.
    const next = s.agent ? starts.find((x) => x.at > s.at && x.agent === s.agent && !x.message) : null;
    const stop = !s.message && s.agent ? stops.find((x) => x.agent === s.agent && time(x) >= s.at && (!next || time(x) < next.at)) : null;
    s.stopped = stop && (!verdict || time(stop) < time(verdict)) ? time(stop) : null;
    s.end = s.message ? s.at : (s.stopped ?? (verdict ? time(verdict) : null));
  }
  return { entries, time, startsWork, launchOf, starts, verdictOf };
}

/**
 * A session's ledger as the office's beats, in the order they happened.
 *
 * A foreground dispatch's `dispatch` entry is written when the agent has finished, after its own verdict, so work
 * starts where its `pre` entry stands, joined to the agent by the tool_use id; until that entry is written, the
 * agent is not known yet, and the page binds the next verdict from that desk to it. A pass that closes a task — the
 * verdict that ends a cycle of the timeline, qa's `PASS` — is a party at once, whoever else is at work. Any other pass
 * ends the work — a party — when nothing since the last dispatch was sent back, something since then could route to
 * `done`, nobody is still at work, and no dispatch follows within `PARTY_QUIET_MS`; at once when the pass routes only
 * to a terminal. A party that waits on the quiet is only beaten once `now` has passed it. So is the beat that sends one
 * whose report is in home (`home`): `HANDOFF_MS` after its verdict, when no dispatch and no party came between.
 *
 * @param {object[]} entries - The ledger, oldest first.
 * @param {{edges: {from: string, to: string, token: string}[]}} graph - The project's parsed graph.
 * @param {number} [now] - The time a waiting party or a going home is judged against; `Infinity` for a session that has ended.
 * @param {(start: object) => number|null} [heard] - When a run last wrote its transcript (`runClock`), or null.
 * @returns {object[]} Beats, each `{id, at, type, ...}`; the id is stable as the ledger grows.
 */
export function officeBeats(ledger, graph, now = Date.now(), heard = () => null) {
  const { entries, time, startsWork, launchOf, starts } = readStarts(ledger);
  // A run's transcript is looked at only for a run that may still be at work.
  const quietMoments = new Map();
  const quietAt = (s) => {
    if (!quietMoments.has(s)) quietMoments.set(s, staleAt(s, heard(s)));
    return quietMoments.get(s);
  };
  const busyAt = (moment) =>
    starts.some((s) => !s.message && s.at <= moment && !(s.refusedAt !== null && s.refusedAt <= moment) && !(s.end !== null && s.end <= moment) && moment < quietAt(s));

  const beats = [];
  const seen = new Map();
  /** An id stable as the ledger grows: the tool_use id where there is one, else what the entry says and its count. */
  const idOf = (e) => {
    if (e.id) return `${e.k}:${e.id}`;
    const key = `${e.k}:${e.at}:${e.agent ?? e.role ?? ''}`;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    return `${key}:${nth}`;
  };
  let reported = null;
  let batch = [];
  entries.forEach((e, i) => {
    const at = time(e);
    const id = idOf(e);
    if (startsWork(e)) {
      const start = starts.find((s) => s.i === i);
      const launched = launchOf(e);
      if (!start.message) batch = [];
      // The folder comes from whoever reported last only along an edge of the graph — a diff to its reviewer, a
      // rejection back to its fixer; work the orchestrator hands out on its own plan, it carries itself.
      const handed = reported && graph.edges.some((edge) => edge.from === reported.role && edge.token === reported.verdict && edge.to === e.role);
      // A message is told apart by its id too: an agent that stopped without a declared verdict left nothing on the
      // ledger, so until the dispatch says it was resumed, its resumption looks like a message — and the id that
      // changes when the dispatch lands is what reaches a page that already has the guess.
      // A refusal names the work by that same id, so the page finds whoever sat down for it.
      const work = start.message ? `${id}:message` : id;
      beats.push({ id: work, at, type: 'work', role: e.role, agent: start.agent, resumed: launched?.via === 'SendMessage' && !start.message, message: start.message, from: handed ? reported : null });
      if (start.refusedAt !== null) beats.push({ id: `refused:${id}`, at: start.refusedAt, type: 'refused', role: e.role, work });
      else if (start.stopped !== null) beats.push({ id: `stale:${id}`, at: start.stopped, type: 'stale', role: e.role, agent: start.agent, work: id });
      else if (!start.message && (start.end === null || (start.end - start.at >= SILENT_MS && start.end >= quietAt(start))) && now >= quietAt(start)) {
        beats.push({ id: `stale:${id}`, at: quietAt(start), type: 'stale', role: e.role, agent: start.agent, work: id });
      }
      return;
    }
    if (e.k === 'verdict' && e.declared && e.role && e.agent) {
      const routes = graph.edges.filter((edge) => edge.from === e.role && edge.token === e.verdict);
      const back = isLoopBack(e.verdict);
      beats.push({ id, at, type: 'verdict', role: e.role, agent: e.agent, verdict: e.verdict, back, asks: routes.some((r) => r.to === 'human'), issues: e.issues ?? [] });
      reported = { role: e.role, agent: e.agent, verdict: e.verdict, back };
      // A task closed is the work done, whoever else is still at work on another: held to an empty office, a day of
      // work side by side in worktrees closed 25 tasks and had one party. Its party had, so it ends nothing more for
      // what reports beside it.
      if (CYCLE_ENDS[e.role] === e.verdict) {
        beats.push({ id: `party:${id}`, at, type: 'party', role: e.role, verdict: e.verdict });
        return;
      }
      batch.push({ back, ends: routes.some((r) => r.to === 'done') });
      // The work ends here when nothing sent back since the last dispatch, something since then could end it, and
      // nobody is still at work: at once when this verdict goes nowhere but a terminal, or once the quiet passes.
      if (back || batch.some((v) => v.back) || !batch.some((v) => v.ends)) return;
      const final = routes.length > 0 && routes.every((r) => TERMINALS.has(r.to));
      const moment = final ? at : at + PARTY_QUIET_MS;
      const later = entries.slice(i + 1);
      const next = later.find((x) => startsWork(x) && !starts.find((s) => s.i === entries.indexOf(x))?.message);
      if (next && time(next) < moment) return;
      // A verdict of the same batch that comes before the moment decides instead: a dba beside the reviewer still
      // has its say, and the batch has one party, not one per pass.
      if (later.some((x) => x.k === 'verdict' && x.declared && x.agent && time(x) <= moment && (!next || time(x) < time(next)))) return;
      if (!final && !next && now < moment) return;
      if (busyAt(moment)) return;
      beats.push({ id: `party:${id}`, at: moment, type: 'party', role: e.role, verdict: e.verdict });
      return;
    }
    if (e.k === 'question') beats.push({ id, at, type: 'question' });
    else if (e.k === 'answered') beats.push({ id, at, type: 'answered' });
    else if (e.k === 'ask') beats.push({ id, at, type: 'cap', role: e.role, source: e.source, token: e.token, round: e.round, max: e.max });
    // A reset written for the model's own question, by ledgers older than the `question` entry, is not the owner.
    else if (e.k === 'reset' && e.why !== 'ask') beats.push({ id, at, type: 'owner' });
  });
  // One whose report is in goes home once `HANDOFF_MS` passes with no dispatch and no party, either of which sends the
  // reported on anyway. Its work, handed on later, the orchestrator carries. One that asked the owner stays with its
  // question until the work moves on. "After" is the ledger's order, which the beats keep until they are sorted: a
  // qa's party falls at its verdict's own moment.
  const moves = beats.flatMap((b, i) => ((b.type === 'work' && !b.message) || b.type === 'party' ? [{ i, at: b.at }] : []));
  const home = [];
  beats.forEach((v, i) => {
    if (v.type !== 'verdict' || v.asks) return;
    const moment = v.at + HANDOFF_MS;
    if (now < moment || moves.some((m) => m.i > i && m.at <= moment)) return;
    home.push({ id: `home:${v.id}`, at: moment, type: 'home', role: v.role, agent: v.agent });
  });
  beats.push(...home);
  // Stable: beats of one moment keep the ledger's order. A beat that waited — a party, a refusal — sorts where it fell.
  return beats.sort((a, b) => a.at - b.at);
}

/**
 * The session's tasks for the timeline beside the room, oldest first: its runs cut the way `nina runs` cuts a session
 * (`cyclesOf`), each named by the description its first dispatch was given — the ledger's, or, for a ledger from
 * before the gate kept one, the measurement store's (`names`) — with who worked on it, when it started and ended, and
 * how long anyone was at work on it.
 *
 * It is the whole list, cut again each time, and the page replaces what it has with it: the cut moves as the ledger
 * grows — a run still at work lets nothing through until its verdict, a dispatch is known refused only seconds later
 * — and sent piece by piece, a task that a later fact merged away stayed on the page for good.
 *
 * A task still open lists its agents at work, oldest first, each with its stage, the words its own dispatch was given,
 * when it started, how much context it holds and what it is doing (`runState`) — the detail Claude Code shows of its
 * own running agents. Every task says when the last of its runs started or ended, which an idle one counts up to.
 *
 * @param {object[]} ledger - The ledger, oldest first.
 * @param {number} [now] - The moment it is read at: a run with no verdict that has not gone quiet is still at work.
 * @param {Map<string, string>} [names] - Descriptions by dispatch id, for entries that carry none.
 * @param {(start: object) => number|null} [heard] - When a run last wrote its transcript (`runClock`), or null.
 * @param {(start: object) => {tokens: number|null, doing: string|null}|null} [state] - A run as its transcript tells it (`runState`).
 * @returns {{key: string, name: string|null, start: number, end: number|null, last: number, how: string|null, busy: number|null, who: [string, number][], agents: {role: string, desc: string|null, start: number, tokens: number|null, doing: string|null}[]}[]}
 */
export function officeTimeline(ledger, now = Date.now(), names = new Map(), heard = () => null, state = () => null) {
  const { entries, starts, verdictOf } = readStarts(ledger);
  // A run a message started — an agent resumed after it had reported — is named by the message's summary, or, in a
  // ledger from before the gate kept one, by the words the agent was launched with: it goes on with that work.
  const launched = new Map();
  for (const e of entries) if (e.k === 'dispatch' && e.via !== 'SendMessage' && e.agent && e.desc && !launched.has(e.agent)) launched.set(e.agent, e.desc);
  const runs = starts
    .filter((s) => !s.message && s.refusedAt === null)
    .map((s) => {
      const e = entries[s.i];
      const v = verdictOf(s);
      return { ts: e.at, role: s.role, verdict: v ? v.verdict : now < staleAt(s, heard(s)) ? IN_FLIGHT : null, desc: e.desc ?? names.get(e.id) ?? (s.agent ? launched.get(s.agent) : undefined) ?? null, start: s, key: e.id ?? `at${s.i}` };
    });
  return cyclesOf(runs).map((cycle) => {
    const first = cycle.runs[0];
    const who = new Map();
    for (const r of cycle.runs) who.set(r.role, (who.get(r.role) ?? 0) + 1);
    // A task its closing verdict ended while one of its runs is still at work stays open until that run reports: work
    // planned side by side — three architects sent together, one of whose specs went on to qa — fell inside the task
    // the first one's qa closed, and the room showed two architects at work beside a list with no task open.
    const atWork = cycle.runs.filter((r) => r.verdict === IN_FLIGHT && r.start.end == null);
    const open = cycle.end === 'open' || atWork.length > 0;
    const last = Math.max(...cycle.runs.map((r) => r.start.end ?? r.start.at));
    return {
      key: first.key,
      name: first.desc ? String(first.desc) : null,
      start: first.start.at,
      end: open ? null : last,
      last,
      how: open ? null : cycle.end,
      busy: open ? null : busyFor(cycle.runs.map((r) => r.start)),
      who: [...who],
      agents: atWork.map((r) => {
        const told = state(r.start);
        return { role: r.role, desc: r.desc ? String(r.desc) : null, start: r.start.at, tokens: told?.tokens ?? null, doing: told?.doing ?? null };
      }),
    };
  });
}

/**
 * Descriptions by dispatch id from a project's measurement store, for a ledger written before the gate kept them:
 * read again only when the store has changed since — a dispatch the store never names would otherwise have it read
 * whole every few seconds for as long as the office runs.
 *
 * @param {string} target - The project directory.
 * @returns {(entries: object[]) => Map<string, string>}
 */
export function storeNames(target) {
  let seen = { file: null, mtime: -1, names: new Map() };
  return (entries) => {
    const missing = entries.some((e) => (e.k === 'pre' || e.k === 'dispatch') && e.via !== 'SendMessage' && e.id && !e.desc && !seen.names.has(e.id));
    if (!missing) return seen.names;
    try {
      const file = projectStoreFile(target);
      const mtime = file ? statSync(file).mtimeMs : -1;
      if (file !== seen.file || mtime !== seen.mtime) {
        const records = file ? readStoreFile(file) : [];
        seen = { file, mtime, names: new Map(records.filter((r) => r.dispatch_id && r.desc).map((r) => [r.dispatch_id, String(r.desc)])) };
      }
    } catch {
      // A store that cannot be read names nothing; the ledger's own words still do.
    }
    return seen.names;
  };
}

/** The most desks a stage is given, two rows of a room: one project's busiest day ran eight implementers at once. */
export const SEATS_MAX = 8;

/**
 * The most runs of each stage the ledgers had at work at once: from each run's start to its verdict or its stop. A run
 * that never reported is left out — it would size the room for a run nobody is waiting on.
 *
 * @param {object[][]} ledgers - Ledgers, each oldest first.
 * @returns {Map<string, number>}
 */
export function busiest(ledgers) {
  const most = new Map();
  for (const ledger of ledgers) {
    const marks = readStarts(ledger)
      .starts.filter((s) => !s.message && s.refusedAt === null && s.end !== null)
      .flatMap((s) => [
        { at: s.at, role: s.role, d: 1 },
        { at: s.end, role: s.role, d: -1 },
      ])
      // One that reported as another sat down was not at work beside it.
      .sort((a, b) => a.at - b.at || a.d - b.d);
    const now = new Map();
    for (const m of marks) {
      now.set(m.role, (now.get(m.role) ?? 0) + m.d);
      most.set(m.role, Math.max(most.get(m.role) ?? 0, now.get(m.role)));
    }
  }
  return most;
}

/**
 * What the page is told about the room: the project, its stages in the order the line takes them, the stages that
 * run as several agents at once, the desks each stage gets, and what to call the owner. A stage gets as many desks
 * as the gate's ledgers — thirty days of them — ever had its agents at work at once, two for a stage the graph
 * declares `× many`, one at least, `SEATS_MAX` at most: two desks for a reviewer split by axis of risk, one for a qa
 * that a day of worktrees ran four of, and the rest worked standing beside a desk.
 *
 * @param {string} target - The project directory.
 * @returns {{project: string, stages: string[], many: string[], seats: Record<string, number>, owner: string}}
 */
export function officeRoom(target) {
  const graph = parseGraph(readFileSync(join(target, '.claude', 'graph.md'), 'utf8'));
  const { line, gates } = shapeOf(graph);
  const stages = [...new Set([...line, ...gates.map((g) => g.gate), ...graph.stages])];
  const many = [...(graph.many ?? new Map()).keys()];
  // A ledger pruned by another session between the listing and the read sizes nothing, and the office still opens.
  const read = (path) => {
    try {
      return [readLedger(path)];
    } catch {
      return [];
    }
  };
  const most = busiest(sessionLedgers(target).ledgers.flatMap((l) => read(l.path)));
  const seats = Object.fromEntries(stages.map((s) => [s, Math.min(SEATS_MAX, Math.max(many.includes(s) ? 2 : 1, most.get(s) ?? 0))]));
  const owner = readProfile(target).profile?.vocabulary?.OWNER;
  return { project: basename(target), stages, many, seats, owner: typeof owner === 'string' && owner.trim() ? owner.trim() : 'you' };
}

/** One server-sent event. */
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * The office's paths, for a server to mount: the page and its stream of beats and timeline, polling the ledger while
 * anyone watches live. `serveOffice` mounts them at the root; the dashboard (`nina dashboard`) at `/office/`, where the
 * page's relative `events` reaches `/office/events`.
 *
 * @param {{target: string, wanted?: string, replay?: boolean}} options
 * @returns {{handle: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, path: string) => boolean, close: () => void}}
 */
export function officeRoutes({ target, wanted, replay = false }) {
  const room = officeRoom(target);
  const graph = parseGraph(readFileSync(join(target, '.claude', 'graph.md'), 'utf8'));
  // A function, so a `$&` or `$'` in a project's name or its owner's is text and not a replacement pattern.
  const roomJson = JSON.stringify({ ...room, replay }).replace(/</g, '\\u003c');
  const page = readFileSync(PAGE, 'utf8').replace('/*NINA_ROOM*/null', () => roomJson);
  const clients = new Set();
  const timers = new Set();

  const names = storeNames(target);
  const files = runFiles(target);
  const clock = runClock(files);
  const looks = runState(files);
  const wake = wakeClock();

  /** The session to show, and its entries; read again only when its ledger changed. */
  let cached = { path: null, size: -1, mtime: 0, entries: [] };
  const current = () => {
    // A session named by the start of its id stays the one picked when a later session's id starts the same way.
    const picked = sessionLedgers(target, wanted).picked ?? (wanted && cached.path ? { session: cached.session, path: cached.path } : null);
    if (!picked) return { session: null, entries: [] };
    let stat;
    try {
      stat = statSync(picked.path);
    } catch {
      return { session: null, entries: [] };
    }
    if (cached.path !== picked.path || cached.size !== stat.size || cached.mtime !== stat.mtimeMs) {
      cached = { session: picked.session, path: picked.path, size: stat.size, mtime: stat.mtimeMs, entries: readLedger(picked.path) };
    }
    return { session: picked.session, entries: cached.entries };
  };

  // A client is handed what came before it connected at once, to set the room by; a session that starts while it
  // watches, it sees happen. Moving to a session that was already running — two sessions in one project take turns
  // being the newest — what it did before the move sets the room too, rather than playing out again.
  const greet = (client, state) => {
    client.restoring = client.session === undefined;
    client.since = client.restoring ? Number.NEGATIVE_INFINITY : Date.now() - SWITCH_GRACE_MS;
    client.session = state.session;
    client.sent = new Set();
    client.timeline = null;
    send(client.res, 'hello', { session: state.session, replay });
  };

  // The timeline, whole, to a client whose copy differs from it.
  const tell = (client, tasks) => {
    const text = JSON.stringify(tasks);
    if (client.timeline === text) return;
    client.timeline = text;
    send(client.res, 'timeline', { tasks });
  };

  const tick = () => {
    const now = Date.now();
    // Looked at whether anyone watches, so a look long after the last is the machine having slept, not nobody watching.
    const woke = wake(now);
    // Nobody watching live: nothing to cut or send.
    if (![...clients].some((client) => !client.replay)) return;
    const state = current();
    const written = clock(state.session);
    const heard = (start) => {
      const at = written(start);
      return at === null ? null : Math.max(at, woke);
    };
    const beats = officeBeats(state.entries, graph, now, heard);
    const tasks = officeTimeline(state.entries, now, names(state.entries), heard, looks(state.session));
    for (const client of clients) {
      if (client.replay) continue;
      if (client.session !== state.session) greet(client, state);
      for (const beat of beats) {
        if (client.sent.has(beat.id)) continue;
        client.sent.add(beat.id);
        send(client.res, 'beat', { ...beat, instant: client.restoring || beat.at < client.since });
      }
      tell(client, tasks);
      client.restoring = false;
    }
  };

  const play = (client) => {
    const state = current();
    greet(client, state);
    const heard = clock(state.session);
    const beats = officeBeats(state.entries, graph, Number.POSITIVE_INFINITY, heard);
    // The timeline as it stood at each beat: cut from the ledger up to that moment, so a replay tells nothing early.
    const known = names(state.entries);
    const look = looks(state.session);
    const tasksAt = (moment) => officeTimeline(state.entries.filter((e) => Date.parse(e?.at) <= moment), moment, known, heard, (start) => look(start, moment));
    // What came before the first dispatch sets the room, at once: a session often opens on many of the owner's
    // messages, and played out they kept the office empty for a minute.
    let i = Math.max(0, beats.findIndex((b) => b.type === 'work'));
    for (const beat of beats.slice(0, i)) send(client.res, 'beat', { ...beat, instant: true });
    if (i > 0) tell(client, tasksAt(beats[i - 1].at));
    const next = () => {
      if (!clients.has(client)) return;
      if (i >= beats.length) {
        send(client.res, 'end', { beats: beats.length });
        return;
      }
      const beat = beats[i];
      send(client.res, 'beat', beat);
      tell(client, tasksAt(beat.at));
      i += 1;
      // The owner speaking moves nobody across the room: it passes quickly. An answer keeps its wait, or the question
      // it answers would not be seen.
      const quick = i < beats.length && beats[i].type === 'owner';
      const gap = i < beats.length && !quick ? beats[i].at - beat.at : 0;
      const timer = setTimeout(() => {
        timers.delete(timer);
        next();
      }, Math.min(REPLAY_MAX_GAP_MS, Math.max(REPLAY_MIN_GAP_MS, gap)));
      timers.add(timer);
    };
    next();
  };

  /**
   * Serves the office's own paths — `/` and `/events`, relative to where it is mounted — and says whether it did.
   *
   * @returns {boolean}
   */
  const handle = (req, res, path) => {
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page);
      return true;
    }
    if (path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': the office\n\n');
      const client = { res, session: undefined, sent: new Set(), restoring: false, replay };
      clients.add(client);
      req.on('close', () => clients.delete(client));
      if (replay) play(client);
      else tick();
      return true;
    }
    return false;
  };

  const poll = setInterval(tick, POLL_MS);
  const close = () => {
    clearInterval(poll);
    for (const timer of timers) clearTimeout(timer);
    for (const client of clients) client.res.end();
    clients.clear();
  };
  return { handle, close };
}

/**
 * Serves the office on its own: the page at `/`, its beats at `/events` as server-sent events (`officeRoutes`). Live,
 * each client is handed the session's beats so far to set the room by, at once, and then each new one as the gate
 * writes it, following the newest session unless one was named; a replay plays one session from its start, its gaps
 * shortened.
 *
 * @param {{target: string, wanted?: string, replay?: boolean, port?: number}} options
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
export async function serveOffice({ target, wanted, replay = false, port = OFFICE_PORT }) {
  const routes = officeRoutes({ target, wanted, replay });
  const server = createServer((req, res) => {
    if (refuseElsewhere(req, res)) return;
    if (routes.handle(req, res, new URL(req.url ?? '/', 'http://localhost').pathname)) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not here\n');
  });
  let url;
  try {
    url = await listenHere(server, port);
  } catch (error) {
    routes.close();
    throw error;
  }
  const close = () =>
    new Promise((resolveClose) => {
      routes.close();
      server.close(() => resolveClose());
    });
  return { url, close };
}

/**
 * Runs the office until Ctrl+C: serves it, says where for a click, and opens it in the system's browser when asked.
 *
 * @param {{target: string, wanted?: string, replay?: boolean, port?: number, open?: boolean}} options
 * @returns {Promise<number>} Process exit code.
 */
export async function viewOffice({ target, wanted, replay = false, port = OFFICE_PORT, open = false }) {
  if (wanted) {
    const { picked, why, dir } = sessionLedgers(target, wanted);
    if (!picked) {
      console.error(`  ${why ?? 'the gate has no ledger here yet'} (${dir})\n`);
      return 2;
    }
  } else if (replay && !sessionLedgers(target).picked) {
    console.error('  the gate has no ledger here yet, so there is no session to replay\n');
    return 2;
  }
  let office;
  try {
    office = await serveOffice({ target, wanted, replay, port });
  } catch (error) {
    console.error(`  the office could not open a port — ${error?.message ?? error}\n`);
    return 1;
  }
  const stopped = untilStopped();
  const what = replay ? `replaying session ${sessionLedgers(target, wanted).picked.session.slice(0, 8)}` : wanted ? `live, session ${wanted}` : 'live, following the newest session';
  const opened = open ? await openInBrowser(office.url) : false;
  // The address ends its line, with nothing after it, so a terminal makes it a link.
  console.log(`  the office · ${basename(target)} · ${what}`);
  if (open && !opened) console.log('  No browser could be opened from here.');
  console.log(`  ${opened ? 'Opened in your browser' : 'Click to watch your agents at work'}: ${office.url}`);
  console.log('  Ctrl+C closes the office.\n');
  await stopped;
  await office.close();
  return 0;
}
