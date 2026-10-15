/**
 * `nina pipeline --view` — the pipeline as an office seen from above, drawn in a browser page.
 *
 * Each stage of the project's composed graph has a desk, and each agent the loop gate saw launched is someone
 * sitting at one. The gate's ledger is what is read, and it holds metadata only, so the office shows who worked,
 * what they answered, the ids of the issues they named and the few words the orchestrator gave each dispatch —
 * never what an agent wrote or reported. Beside the room, a timeline of the session's tasks (`officeTimeline`), cut
 * and named as `nina runs` cuts and names them:
 *
 *   a dispatch                        someone sits down to work, the folder carried over by whoever handed it on
 *   a verdict                         a check over their head, or a cross when it sends work back
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

import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERMINALS, parseGraph } from './graph.mjs';
import { readLedger, sessionLedgers } from './gate.mjs';
import { readProfile } from './paths.mjs';
import { projectStoreFile, readStoreFile } from './store.mjs';
import { CYCLE_ENDS, IN_FLIGHT, cyclesOf } from './commands/stats.mjs';
import { isLoopBack } from './transcripts.mjs';
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

/** How far back, when a live client moves to a session already running, beats still play rather than set the room. */
const SWITCH_GRACE_MS = 10_000;

/**
 * How long a run may go without reporting before the office stops counting it as at work: the longest of 227 runs
 * measured across three projects took 108 minutes, and the 99th percentile 73. A run that stopped without a verdict
 * kept every later party away for the rest of its session.
 */
export const STALE_MS = 3 * 60 * 60 * 1000;

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
  const entries = ledger.filter((e) => Number.isFinite(Date.parse(e?.at)));
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
  // went on to something else; or stale, a run that never reported within `STALE_MS`.
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
    starts.push({ i, at, role: e.role, agent: launched?.agent ?? null, message, refusedAt: after ? time(after) : null });
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
 * to a terminal. A party that waits on the quiet is only beaten once `now` has passed it.
 *
 * @param {object[]} entries - The ledger, oldest first.
 * @param {{edges: {from: string, to: string, token: string}[]}} graph - The project's parsed graph.
 * @param {number} [now] - The time a waiting party is judged against; `Infinity` for a session that has ended.
 * @returns {object[]} Beats, each `{id, at, type, ...}`; the id is stable as the ledger grows.
 */
export function officeBeats(ledger, graph, now = Date.now()) {
  const { entries, time, startsWork, launchOf, starts } = readStarts(ledger);
  const busyAt = (moment) =>
    starts.some((s) => !s.message && s.at <= moment && moment - s.at < STALE_MS && !(s.refusedAt !== null && s.refusedAt <= moment) && !(s.end !== null && s.end <= moment));

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
      else if (!start.message && (start.end === null || start.end - start.at >= STALE_MS) && now >= start.at + STALE_MS) {
        beats.push({ id: `stale:${id}`, at: start.at + STALE_MS, type: 'stale', role: e.role, agent: start.agent, work: id });
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
 * @param {object[]} ledger - The ledger, oldest first.
 * @param {number} [now] - The moment it is read at: a run younger than `STALE_MS` with no verdict is still at work.
 * @param {Map<string, string>} [names] - Descriptions by dispatch id, for entries that carry none.
 * @returns {{key: string, name: string|null, start: number, end: number|null, how: string|null, busy: number|null, who: [string, number][]}[]}
 */
export function officeTimeline(ledger, now = Date.now(), names = new Map()) {
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
      return { ts: e.at, role: s.role, verdict: v ? v.verdict : now < s.at + STALE_MS ? IN_FLIGHT : null, desc: e.desc ?? names.get(e.id) ?? (s.agent ? launched.get(s.agent) : undefined) ?? null, start: s, key: e.id ?? `at${s.i}` };
    });
  return cyclesOf(runs).map((cycle) => {
    const first = cycle.runs[0];
    const who = new Map();
    for (const r of cycle.runs) who.set(r.role, (who.get(r.role) ?? 0) + 1);
    // A task its closing verdict ended while one of its runs is still at work stays open until that run reports: work
    // planned side by side — three architects sent together, one of whose specs went on to qa — fell inside the task
    // the first one's qa closed, and the room showed two architects at work beside a list with no task open.
    const open = cycle.end === 'open' || cycle.runs.some((r) => r.verdict === IN_FLIGHT && r.start.end == null);
    return {
      key: first.key,
      name: first.desc ? String(first.desc) : null,
      start: first.start.at,
      end: open ? null : Math.max(...cycle.runs.map((r) => r.start.end ?? r.start.at)),
      how: open ? null : cycle.end,
      busy: open ? null : busyFor(cycle.runs.map((r) => r.start)),
      who: [...who],
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
    // Nobody watching live: nothing to cut or send.
    if (![...clients].some((client) => !client.replay)) return;
    const state = current();
    const now = Date.now();
    const beats = officeBeats(state.entries, graph, now);
    const tasks = officeTimeline(state.entries, now, names(state.entries));
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
    const beats = officeBeats(state.entries, graph, Number.POSITIVE_INFINITY);
    // The timeline as it stood at each beat: cut from the ledger up to that moment, so a replay tells nothing early.
    const known = names(state.entries);
    const tasksAt = (moment) => officeTimeline(state.entries.filter((e) => Date.parse(e?.at) <= moment), moment, known);
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
