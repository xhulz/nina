/**
 * `nina pipeline --view` — the pipeline as an office seen from above, drawn in a browser page.
 *
 * Each stage of the project's composed graph has a desk, and each agent the loop gate saw launched is someone
 * sitting at one. The gate's ledger is the only thing read, and it holds metadata only, so the office shows who
 * worked, what they answered and the ids of the issues they named — never what anyone wrote:
 *
 *   a dispatch                        someone sits down to work, the folder carried over by whoever handed it on
 *   a verdict                         a check over their head, or a cross when it sends work back
 *   a verdict the graph sends to the  a question mark over the one who asked, until the owner speaks
 *   owner, or the orchestrator asking
 *   the gate asking at a cap          the owner's phone rings
 *   a pass that ends the work         a party
 *
 * The page is served from this machine alone, on the loopback address, for as long as the command runs. VS Code
 * shows it beside the conversation in its Simple Browser. A Claude Code mod was the first idea, and a probe on
 * 2.1.294 settled it: in the editor's chat panel a mod's hooks run, its session reports no surface to draw on, and
 * no drawing is ever asked for. A mod draws in the terminal and the desktop app only.
 */

import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERMINALS, parseGraph } from './graph.mjs';
import { readLedger, sessionLedgers } from './gate.mjs';
import { readProfile } from './paths.mjs';
import { isLoopBack } from './transcripts.mjs';
import { shapeOf } from './commands/pipeline.mjs';

/** The page, one self-contained file: the room, the sprites and the animation, with nothing fetched from anywhere. */
const PAGE = join(dirname(fileURLToPath(import.meta.url)), 'office.html');

/** The port it asks for first: NINA on a phone's keypad. Taken, any free one. */
export const OFFICE_PORT = 6462;

/**
 * How long after a pass that could end the work the office waits for another dispatch before it celebrates. A pass
 * from qa may go on to devops or secops, and the orchestrator commits before it dispatches either; a pass the graph
 * sends nowhere but `done` is celebrated at once.
 */
export const PARTY_QUIET_MS = 20_000;

/** How often a live office looks at the ledger. The gate appends to it as each fact happens. */
const POLL_MS = 700;

/** The longest a replay waits between two beats, and the shortest: hours of a session play in minutes. */
const REPLAY_MAX_GAP_MS = 3000;
const REPLAY_MIN_GAP_MS = 500;

/**
 * A session's ledger as the office's beats, in the order they happened.
 *
 * A foreground dispatch's `dispatch` entry is written when the agent has finished, after its own verdict, so work
 * starts where its `pre` entry stands, joined to the agent by the tool_use id; until that entry is written, the
 * agent is not known yet, and the page binds the next verdict from that desk to it. The work ends — a party — on a
 * pass when nothing since the last dispatch was sent back, something since then could route to `done`, nobody is
 * still at work, and no dispatch follows within `PARTY_QUIET_MS`; at once when the pass routes only to a terminal.
 * A party that waits on the quiet is only beaten once `now` has passed it.
 *
 * @param {object[]} entries - The ledger, oldest first.
 * @param {{edges: {from: string, to: string, token: string}[]}} graph - The project's parsed graph.
 * @param {number} [now] - The time a waiting party is judged against; `Infinity` for a session that has ended.
 * @returns {object[]} Beats, each `{id, at, type, ...}`; the id is stable as the ledger grows.
 */
export function officeBeats(entries, graph, now = Date.now()) {
  const dispatches = new Map();
  for (const e of entries) if (e.k === 'dispatch' && e.id && !dispatches.has(e.id)) dispatches.set(e.id, e);
  const announced = new Set(entries.filter((e) => e.k === 'pre' && e.id).map((e) => e.id));
  const startsWork = (e) => Boolean(e.role) && (e.k === 'pre' || (e.k === 'dispatch' && !(e.id && announced.has(e.id))));
  const launchOf = (e) => (e.k === 'pre' ? dispatches.get(e.id) : e);
  const time = (e) => Date.parse(e.at);
  const routesOf = (role, token) => graph.edges.filter((edge) => edge.from === role && edge.token === token);

  // Who was at work when: each start, and each verdict that ends one. A message to an agent still running adds
  // to its run, and a start whose agent is not known yet — a foreground run still going — ends with nothing.
  const works = entries.filter((e) => startsWork(e) && !(launchOf(e)?.via === 'SendMessage' && !launchOf(e).resumed)).map((e) => ({ at: time(e), agent: launchOf(e)?.agent ?? null }));
  const verdicts = entries.filter((e) => e.k === 'verdict' && e.declared && e.agent).map((e) => ({ at: time(e), agent: e.agent }));
  const busyAt = (moment) => works.some((w) => w.at <= moment && !(w.agent && verdicts.some((v) => v.agent === w.agent && v.at >= w.at && v.at <= moment)));

  const beats = [];
  let reported = null;
  let batch = [];
  entries.forEach((e, i) => {
    const at = time(e);
    if (!Number.isFinite(at)) return;
    const id = `${e.k}:${e.id ?? `${e.at}:${e.agent ?? e.role ?? i}`}`;
    if (startsWork(e)) {
      const launched = launchOf(e);
      const via = launched?.via;
      const message = via === 'SendMessage' && !launched.resumed;
      if (!message) batch = [];
      // The folder comes from whoever reported last only along an edge of the graph — a diff to its reviewer, a
      // rejection back to its fixer; work the orchestrator hands out on its own plan, it carries itself.
      const handed = reported && graph.edges.some((edge) => edge.from === reported.role && edge.token === reported.verdict && edge.to === e.role);
      beats.push({ id, at, type: 'work', role: e.role, agent: launched?.agent ?? null, resumed: via === 'SendMessage' && Boolean(launched.resumed), message, from: handed ? reported : null });
      return;
    }
    if (e.k === 'verdict' && e.declared && e.role && e.agent) {
      const routes = routesOf(e.role, e.verdict);
      const back = isLoopBack(e.verdict);
      beats.push({ id, at, type: 'verdict', role: e.role, agent: e.agent, verdict: e.verdict, back, asks: routes.some((r) => r.to === 'human'), issues: e.issues ?? [] });
      reported = { role: e.role, agent: e.agent, verdict: e.verdict, back };
      batch.push({ back, ends: routes.some((r) => r.to === 'done') });
      // The work ends here when nothing sent back since the last dispatch, something since then could end it, and
      // nobody is still at work: at once when this verdict goes nowhere but a terminal, or once the quiet passes.
      if (back || batch.some((v) => v.back) || !batch.some((v) => v.ends)) return;
      const final = routes.length > 0 && routes.every((r) => TERMINALS.has(r.to));
      const moment = final ? at : at + PARTY_QUIET_MS;
      const later = entries.slice(i + 1);
      const next = later.find(startsWork);
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
  // Stable: beats of one moment keep the ledger's order. A party that waited on the quiet sorts where it fell.
  return beats.sort((a, b) => a.at - b.at);
}

/**
 * What the page is told about the room: the project, its stages in the order the line takes them, the stages that
 * run as several agents at once, and what to call the owner.
 *
 * @param {string} target - The project directory.
 * @returns {{project: string, stages: string[], many: string[], owner: string}}
 */
export function officeRoom(target) {
  const graph = parseGraph(readFileSync(join(target, '.claude', 'graph.md'), 'utf8'));
  const { line, gates } = shapeOf(graph);
  const stages = [...new Set([...line, ...gates.map((g) => g.gate), ...graph.stages])];
  const owner = readProfile(target).profile?.vocabulary?.OWNER;
  return { project: basename(target), stages, many: [...(graph.many ?? new Map()).keys()], owner: typeof owner === 'string' && owner.trim() ? owner.trim() : 'you' };
}

/** One server-sent event. */
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * Serves the office: the page at `/`, its beats at `/events` as server-sent events. Live, each client is handed the
 * session's beats so far to set the room by, at once, and then each new one as the gate writes it, following the
 * newest session unless one was named; a replay plays one session from its start, its gaps shortened.
 *
 * @param {{target: string, wanted?: string, replay?: boolean, port?: number}} options
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
export async function serveOffice({ target, wanted, replay = false, port = OFFICE_PORT }) {
  const room = officeRoom(target);
  const graph = parseGraph(readFileSync(join(target, '.claude', 'graph.md'), 'utf8'));
  const page = readFileSync(PAGE, 'utf8').replace('/*NINA_ROOM*/null', JSON.stringify({ ...room, replay }).replace(/</g, '\\u003c'));
  const clients = new Set();
  const timers = new Set();

  /** The session to show, and its entries; read again only when its ledger changed. */
  let cached = { path: null, size: -1, mtime: 0, entries: [] };
  const current = () => {
    const { picked } = sessionLedgers(target, wanted);
    if (!picked) return { session: null, entries: [] };
    let stat;
    try {
      stat = statSync(picked.path);
    } catch {
      return { session: null, entries: [] };
    }
    if (cached.path !== picked.path || cached.size !== stat.size || cached.mtime !== stat.mtimeMs) {
      cached = { path: picked.path, size: stat.size, mtime: stat.mtimeMs, entries: readLedger(picked.path) };
    }
    return { session: picked.session, entries: cached.entries };
  };

  // A client is handed what came before it connected at once, to set the room by; a session that starts while it
  // watches, it sees happen.
  const greet = (client, state) => {
    client.restoring = client.session === undefined;
    client.session = state.session;
    client.sent = new Set();
    send(client.res, 'hello', { session: state.session, replay });
  };

  const tick = () => {
    const state = current();
    for (const client of clients) {
      if (client.replay) continue;
      if (client.session !== state.session) greet(client, state);
      for (const beat of officeBeats(state.entries, graph, Date.now())) {
        if (client.sent.has(beat.id)) continue;
        client.sent.add(beat.id);
        send(client.res, 'beat', { ...beat, instant: client.restoring });
      }
      client.restoring = false;
    }
  };

  const play = (client) => {
    const state = current();
    greet(client, state);
    const beats = officeBeats(state.entries, graph, Number.POSITIVE_INFINITY);
    // What came before the first dispatch sets the room, at once: a session often opens on many of the owner's
    // messages, and played out they kept the office empty for a minute.
    let i = Math.max(0, beats.findIndex((b) => b.type === 'work'));
    for (const beat of beats.slice(0, i)) send(client.res, 'beat', { ...beat, instant: true });
    const next = () => {
      if (!clients.has(client)) return;
      if (i >= beats.length) {
        send(client.res, 'end', { beats: beats.length });
        return;
      }
      const beat = beats[i];
      send(client.res, 'beat', beat);
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

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page);
      return;
    }
    if (path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': the office\n\n');
      const client = { res, session: undefined, sent: new Set(), restoring: false, replay };
      clients.add(client);
      req.on('close', () => clients.delete(client));
      if (replay) play(client);
      else tick();
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not here\n');
  });

  const poll = setInterval(tick, POLL_MS);
  const listen = (p) =>
    new Promise((resolveListen, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolveListen();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    });
  try {
    await listen(port);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || port === 0) {
      clearInterval(poll);
      throw error;
    }
    await listen(0);
  }
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () =>
    new Promise((resolveClose) => {
      clearInterval(poll);
      for (const timer of timers) clearTimeout(timer);
      for (const client of clients) client.res.end();
      clients.clear();
      server.close(() => resolveClose());
    });
  return { url, close };
}

/**
 * Runs the office until Ctrl+C: serves it, says where, and how to put it beside the conversation in VS Code.
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
  const what = replay ? `replaying session ${sessionLedgers(target, wanted).picked.session.slice(0, 8)}` : wanted ? `live, session ${wanted}` : 'live, following the newest session';
  console.log(`  the office · ${basename(target)} · ${what}`);
  console.log(`  ${office.url}`);
  console.log('  In VS Code: Cmd+Shift+P (Ctrl+Shift+P) → "Simple Browser: Show" → that address, to watch it beside the conversation.');
  console.log('  Ctrl+C closes it.\n');
  if (open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    try {
      spawn(opener, [office.url], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
    } catch {
      // The address is printed above.
    }
  }
  await new Promise((resolveStop) => {
    process.once('SIGINT', resolveStop);
    process.once('SIGTERM', resolveStop);
  });
  await office.close();
  return 0;
}
