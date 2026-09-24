/**
 * The loop gate: the graph's loop caps as a mechanism rather than an instruction.
 *
 * `.claude/graph.md` has capped every loop-back edge since it was written — `reviewer` → `implementer`
 * on `REJECTED` · max 2 — but the cap was an instruction to the orchestrator, which counted its own
 * rounds, and nothing stopped a third. This makes the count something the harness keeps.
 *
 * It does not read the session transcript to decide. Claude Code writes that file asynchronously, so
 * the verdict a dispatch answers may not be on disk when the dispatch is about to go out, and the file
 * is mostly replay: a session resumed over a bridge rewrites its history, three quarters of the bytes
 * in the one measured. The gate keeps its own ledger instead — one small file per session, metadata
 * only, with the ids a report gave its issues as the one thing a model wrote — written by the hooks
 * that see each fact as it happens:
 *
 *   PostToolUse on SubagentHandback   the report a stage handed back, verbatim — its verdict
 *   SubagentStop                      the same, for a stage that wrote its report as its last message
 *   PreToolUse / PostToolUse on Agent, Task, SendMessage
 *                                     a dispatch launched, and the agent it launched
 *   UserPromptSubmit (human text only), an AskUserQuestion answer
 *                                     the owner spoke, and every count starts over
 *   PreToolUse on Agent, Task, SendMessage
 *                                     the decision: let it through, or send the round past the cap to
 *                                     the owner to confirm
 *
 * The cap sends a loop to the owner — the graph's `human` — so that is where the round past it goes:
 * Claude Code asks the person to allow it or not, in auto mode too. Whether two rounds are "the same
 * issue" cannot be seen from outside the conversation, and three reviews of this code each found a shape
 * the count got wrong; a confirmation makes a wrong count cost one click instead of a stopped pipeline.
 *
 * So the stages say. A report that sends work back names its issues on the line under its verdict, and
 * where every verdict a round acts on did, the round is counted per issue: a review that finds a new
 * problem each round no longer looks like a fix that is not converging. An id is a model's word, and a
 * renamed issue restarts its count, so the edge keeps its own count beside them and still asks once it
 * has gone round more than twice its cap. A round acting on any verdict that named nothing is counted
 * by its edge alone, as every round was before the ids existed.
 *
 * What counts as a round was replayed over six weeks of one project before it was written, where a count
 * of "a dispatch to the stage an edge points at, after a loop-back" was wrong seven times in eight. So:
 * a round is a dispatch that ACTS ON a declared loop-back; several dispatches acting on the same verdicts
 * are one round, and a rejection from a review that was already running when the last round went out
 * belongs to that round; a pass cancels a rejection only if a fix went out between the two — a later
 * review that saw the fix — and closes the loop only if it began after the latest fix with no rejection
 * running beside it; a pass from the stage the source hands its work on to (qa, after the reviewer)
 * closes the source's loops; and the owner speaking empties everything. Guessed verdicts never count.
 *
 * It fails open, and it only acts where the project pins a version that ships it. Any error lets the
 * call through and is logged where `nina gate --selftest`, a detector every project runs, reports it: a
 * gate that could block work on its own crash would be worse than the loops it exists to stop.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERMINALS, declaredTokens, parseGraph } from './graph.mjs';
import { gateDir, slugFor } from './paths.mjs';
import { declaredIssues, isLoopBack } from './transcripts.mjs';

/** The package this runs from: its releases say whether a pinned version ships the gate at all. */
const PACKAGE = dirname(dirname(fileURLToPath(import.meta.url)));

/** A report's declared verdict: the line every stage's spec puts first. */
const DECLARED = /^\s*VERDICT:\s*([A-Z][A-Z-]*)/;

/**
 * A prompt Claude Code delivers on the owner's behalf is not the owner speaking. `UserPromptSubmit`
 * fires for a subagent's report arriving (`<agent-message …>`) and for a background task finishing
 * (`<task-notification>`) exactly as for a person typing — resetting on those emptied every count each
 * time a report came back, and nothing was ever held.
 */
const DELIVERED = /<(task-notification|agent-message|cross-session-message|teammate-message)[\s>]/;

/** How much of a prompt is searched for a delivery tag: some versions put a sentence in front of it. */
const DELIVERY_HEAD = 300;

/** The most of a ledger ever read. The owner's last reply bounds what counts, and a session this long is rare. */
const LEDGER_TAIL = 4 * 1024 * 1024;

/** The most of a subagent's own transcript read looking for its handback. */
const AGENT_TAIL = 512 * 1024;

/** How long a project's ledgers are kept, and its error log's lines, in days. */
const KEEP_DAYS = 30;
const KEEP_ERROR_DAYS = 7;

/**
 * How many times its cap an edge may go round, while every round since the loop last closed named its
 * issues, before it asks anyway. Each issue is held at the cap; this is only for the one way a count by
 * id misses a loop — the same problem given a new name each round — and it waits long enough that a
 * review finding genuinely new problems is not what trips it. Once a round names nothing, the edge's
 * own cap holds again.
 */
const EDGE_CEILING = 2;

/** The tools a dispatch goes out through. `Task` is what `Agent` used to be called. */
const DISPATCH = new Set(['Agent', 'Task', 'SendMessage']);

/**
 * Where a project's ledgers live. Keyed by the project's real path: the composed script finds its
 * project from its own location, which Node reports resolved, and a reader given `/tmp/x` where the
 * writer saw `/private/tmp/x` would find nothing and report a gate that never ran.
 *
 * @param {string} root - The project directory.
 * @returns {string}
 */
export function projectGateDir(root) {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    // A project that does not exist has no ledgers either way.
  }
  return join(gateDir(), slugFor(real));
}

/** The ledger a session writes, under its project. Session ids are UUIDs; nothing else is trusted as a file name. */
export function ledgerPath(root, session) {
  const name = String(session ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'unknown';
  return join(projectGateDir(root), `${name}.jsonl`);
}

/**
 * Whether the version a project pins ships the gate. A composed file outlives the version that
 * composed it — a rolled-back move, a downgrade — and wired hooks run whatever is on disk, so the
 * script asks the pin rather than trusting that it exists.
 *
 * @param {string} root - The project directory.
 * @param {string} [pkg] - The NINA install to look in.
 * @returns {boolean}
 */
export function pinnedShipsGate(root, pkg = PACKAGE) {
  try {
    const core = JSON.parse(readFileSync(join(root, '.nina', 'profile.json'), 'utf8')).core;
    if (typeof core !== 'string' || !/^[A-Za-z0-9._-]+$/.test(core)) return false;
    const layers = core === 'dev' ? pkg : join(pkg, 'releases', core);
    return existsSync(join(layers, 'core', 'tree', 'scripts', 'loop-gate.mjs'));
  } catch {
    return false;
  }
}

/**
 * The declared verdict of a report: its first non-empty line, when that line is `VERDICT: <TOKEN>` with
 * one of the stage's own tokens.
 *
 * @param {unknown} text - A report.
 * @param {Set<string>} [tokens] - The tokens the stage's spec declares; when unknown, any token counts.
 * @returns {string|null}
 */
export function declaredVerdict(text, tokens) {
  const first = String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
  const token = DECLARED.exec(first)?.[1] ?? null;
  return token && (!tokens || tokens.size === 0 || tokens.has(token)) ? token : null;
}

/**
 * Every capped loop-back edge, by source stage and token: `reviewer` on `REJECTED` → {implementer: 2,
 * architect: 2}. Two lines naming one edge keep the larger cap — a composed graph can carry the same
 * route from the core and from a surface, and the lenient reading is the one that cannot block work.
 *
 * @param {ReturnType<typeof parseGraph>} graph - A parsed graph.
 * @returns {Map<string, Map<string, Map<string, number>>>}
 */
export function loopEdges(graph) {
  const out = new Map();
  for (const e of graph.edges) {
    if (TERMINALS.has(e.to) || !isLoopBack(e.token) || e.max === null) continue;
    const byToken = out.get(e.from) ?? new Map();
    const targets = byToken.get(e.token) ?? new Map();
    targets.set(e.to, Math.max(targets.get(e.to) ?? 0, e.max));
    byToken.set(e.token, targets);
    out.set(e.from, byToken);
  }
  return out;
}

/**
 * The stage each source hands passing work on to — the reviewer's to qa — by the stage it hands it to.
 * That stage passing closes the source's loops: a rejection the orchestrator settled itself, without a
 * fixer or a new review, leaves nothing else that would.
 *
 * @param {ReturnType<typeof parseGraph>} graph - A parsed graph.
 * @returns {Map<string, Set<string>>}
 */
export function forwardEdges(graph) {
  const forward = new Map();
  for (const e of graph.edges) {
    if (isLoopBack(e.token) || TERMINALS.has(e.to)) continue;
    forward.set(e.to, new Set([...(forward.get(e.to) ?? []), e.from]));
  }
  return forward;
}

/**
 * What the gate needs from a project: its composed graph and each stage's own verdict tokens. Null when
 * the project has no graph, which means no caps to hold.
 *
 * @param {string} root - The project directory.
 */
export function loadProject(root) {
  const path = join(root, '.claude', 'graph.md');
  if (!existsSync(path)) return null;
  const graph = parseGraph(readFileSync(path, 'utf8'));
  const tokens = new Map();
  for (const stage of graph.stages) {
    const spec = join(root, '.claude', 'agents', `${stage}.md`);
    if (existsSync(spec)) tokens.set(stage, declaredTokens(readFileSync(spec, 'utf8')));
  }
  return { graph, tokens, loops: loopEdges(graph), forward: forwardEdges(graph) };
}

/**
 * A ledger's entries, oldest first. Only its tail is read when it is very large, and a line that does
 * not parse is skipped — a torn write loses one fact, not the ledger.
 *
 * @param {string} path - The ledger file.
 * @returns {object[]}
 */
export function readLedger(path) {
  if (!existsSync(path)) return [];
  const size = statSync(path).size;
  let text;
  if (size <= LEDGER_TAIL) {
    text = readFileSync(path, 'utf8');
  } else {
    const buffer = Buffer.alloc(LEDGER_TAIL);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, LEDGER_TAIL, size - LEDGER_TAIL);
    } finally {
      closeSync(fd);
    }
    text = buffer.toString('utf8');
    text = text.slice(text.indexOf('\n') + 1);
  }
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/** Appends one fact to a ledger. Lines are short, and an append this size is written whole. */
function append(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

/**
 * Replays a session's ledger.
 *
 * Verdicts wait, per source stage, until a dispatch acts on them. Each agent's launches come from the
 * `pre` and `dispatch` entries, so a verdict belongs to one completion of one agent: a second report of
 * the same completion replaces the first, and a report of a later completion — a resumed reviewer — is a
 * new verdict. At a dispatch to X, for each source whose loop-backs can route to X:
 *
 * - a rejection is cancelled by a pass launched after a fix went out for it: that review saw the fix. A
 *   sibling launched with it, or a reviewer launched after it that saw no fix, cancels nothing;
 * - a rejection from a review that was already running when the edge's last round went out belongs to
 *   that round, and makes no new one;
 * - the rest make this dispatch a round on the edge: one more than the rounds since the loop last
 *   closed, which is when a review that began after the latest fix passed with no rejection running
 *   beside it. Where every one of them named its issues, and every round since the loop last closed did
 *   too, the round's number is its most-repeated issue's instead — one more than the rounds that issue
 *   was in since then — and the edge's own number is kept beside it, against a ceiling of twice the cap.
 *   A late sibling's issues are counted in the round it belongs to;
 * - a pass from the stage the source hands passing work on to closes the source's loops outright.
 *
 * @param {object[]} entries - The ledger, oldest first.
 * @param {ReturnType<typeof loopEdges>} loops - The capped loop-back edges.
 * @param {Map<string, Set<string>>} [forward] - Stage → the sources that hand passing work on to it.
 * @returns {{effect: (to: string) => {rounds: object[]}, rounds: object[]}}
 *   A round is `{source, target, token, round, max, edgeRound, ceiling, agents}`, plus `issue` (the id
 *   that decides it) and `issues` (every id with its count) when it was counted by issue.
 *   `effect` says what a dispatch to a stage would make now, without making it; `rounds` is every round
 *   the recorded dispatches made.
 */
export function replay(entries, loops, forward = new Map()) {
  // When each dispatch went out. A foreground dispatch's `dispatch` entry is written after the agent
  // finished, so its moment is where its `pre` entry stands, joined on the tool_use id.
  const preAt = new Map();
  entries.forEach((e, i) => {
    if (e.k === 'pre' && e.id && !preAt.has(e.id)) preAt.set(e.id, i);
  });
  const outAt = (e, i) => (e.id && preAt.has(e.id) ? preAt.get(e.id) : i);
  const launches = new Map();
  const sent = new Map();
  entries.forEach((e, i) => {
    if (e.k !== 'dispatch' || !e.role) return;
    sent.set(e.role, [...(sent.get(e.role) ?? []), outAt(e, i)]);
    // A message to an agent still running adds to its current run; only a resumed one starts another.
    if (e.agent && (e.via !== 'SendMessage' || e.resumed)) launches.set(e.agent, [...(launches.get(e.agent) ?? []), outAt(e, i)]);
  });
  const launchOf = (agent, before) => Math.max(-1, ...(launches.get(agent) ?? []).filter((at) => at < before));
  const targetsOf = (source) => new Set([...(loops.get(source)?.values() ?? [])].flatMap((targets) => [...targets.keys()]));
  const fixBetween = (source, from, to) => [...targetsOf(source)].some((role) => (sent.get(role) ?? []).some((at) => at > from && at < to));

  /** @type {Map<string, {completion: string, agent: string, verdict: string, issues: string[]|null, at: number, launch: number}[]>} */
  const pending = new Map();
  /**
   * `${source}|${to}|${token}` → the edge's rounds since the loop last closed, and whether any of them was
   * counted by the edge (`blind`: one of its reports named nothing, so no issue count covers that round);
   * `${source}|${to}|${token}|${issue}` → the rounds that issue was in, and the edge round it was last in.
   *
   * @type {Map<string, {n: number, agents?: string[], at?: number, blind?: boolean, edge?: number}>}
   */
  const streak = new Map();
  /** Where each source's latest round went out: a pass must begin after it to say the fix passed. */
  const lastFix = new Map();
  /** Completions a dispatch already acted on: a late copy of one is not new. */
  const spent = new Set();
  /** Where each stage last reported, as the entries are replayed. */
  const reportedAt = new Map();
  const made = [];
  const close = (source) => {
    for (const key of [...streak.keys()]) if (key.startsWith(`${source}|`)) streak.delete(key);
  };

  const effect = (to, at) => {
    const rounds = [];
    const outcome = [];
    for (const [source, batch] of pending) {
      const byToken = loops.get(source);
      if (!byToken || batch.length === 0 || !targetsOf(source).has(to)) continue;
      const passes = batch.filter((v) => !isLoopBack(v.verdict));
      const live = batch.filter((v) => isLoopBack(v.verdict) && !passes.some((p) => p.launch > v.at && fixBetween(source, v.at, p.launch)));
      const closes = passes.some((p) => p.launch > (lastFix.get(source) ?? -1) && !live.some((v) => v.launch < p.at));
      const routed = live.filter((v) => byToken.get(v.verdict)?.has(to));
      const fresh = routed.filter((v) => {
        const last = streak.get(`${source}|${to}|${v.verdict}`);
        return closes || !last || v.launch > last.at;
      });
      // A late sibling belongs to the round it was running in, so its issues do too: each is counted in
      // that round, once, and one that named nothing makes that round the edge's. Worked out here rather
      // than when the dispatch is replayed, because this is also what a dispatch about to go out is asked.
      const adopted = new Map();
      const blinded = new Set();
      for (const v of routed.filter((r) => !fresh.includes(r))) {
        const key = `${source}|${to}|${v.verdict}`;
        const edge = streak.get(key);
        if (!edge) continue;
        if (!(v.issues?.length > 0)) blinded.add(key);
        for (const id of v.issues ?? []) {
          const had = adopted.get(`${key}|${id}`) ?? streak.get(`${key}|${id}`);
          if (!had || had.edge < edge.n) adopted.set(`${key}|${id}`, { n: (had?.n ?? 0) + 1, edge: edge.n });
        }
      }
      if (fresh.length > 0) {
        const token = fresh.at(-1).verdict;
        const key = `${source}|${to}|${token}`;
        const max = byToken.get(token).get(to);
        const before = closes ? { n: 0, agents: [] } : (streak.get(key) ?? { n: 0, agents: [] });
        const agents = [...new Set([...(before.agents ?? []), ...fresh.map((v) => v.agent)])];
        // Counted by issue only while every round since the loop last closed named its issues: a round
        // that named nothing advanced no issue's count, so from then on only the edge's count is whole.
        const named = !before.blind && !blinded.has(key) && fresh.every((v) => v.issues?.length > 0);
        const round = { key, source, target: to, token, round: before.n + 1, max, edgeRound: before.n + 1, ceiling: max, blind: !named, agents, at };
        if (named) {
          const issues = [...new Set(fresh.flatMap((v) => v.issues))].map((id) => ({
            id,
            round: (closes ? 0 : ((adopted.get(`${key}|${id}`) ?? streak.get(`${key}|${id}`))?.n ?? 0)) + 1,
          }));
          const worst = issues.reduce((a, b) => (b.round > a.round ? b : a));
          Object.assign(round, { round: worst.round, issue: worst.id, issues, ceiling: max * EDGE_CEILING });
        }
        rounds.push(round);
      }
      outcome.push({ source, keep: live.filter((v) => !routed.includes(v)), closes, fixed: routed.length > 0, adopted, blinded });
    }
    return { rounds, outcome };
  };

  entries.forEach((e, i) => {
    if (e.k === 'reset') {
      pending.clear();
      streak.clear();
      lastFix.clear();
      return;
    }
    if (e.k === 'verdict' && e.declared && e.agent) {
      if (!isLoopBack(e.verdict)) {
        // The next stage passing closes a source's loops only if it ran after the source last reported,
        // and the source was not sent out again since. A reviewer that went out beside a gate — the way
        // the graph says to send them — approving its own review says nothing about the gate's rejection.
        const launched = launchOf(e.agent, i);
        for (const source of forward.get(e.role) ?? []) {
          const last = reportedAt.get(source);
          if (last === undefined || launched < last) continue;
          if ((sent.get(source) ?? []).some((at) => at > last && at < i)) continue;
          for (const v of pending.get(source) ?? []) spent.add(v.completion);
          pending.set(source, []);
          close(source);
        }
      }
      reportedAt.set(e.role, i);
      if (!loops.has(e.role)) return;
      const completion = `${e.agent}@${launchOf(e.agent, i)}`;
      if (spent.has(completion)) return;
      const batch = (pending.get(e.role) ?? []).filter((v) => v.completion !== completion);
      pending.set(e.role, [...batch, { completion, agent: e.agent, verdict: e.verdict, issues: e.issues ?? null, at: i, launch: launchOf(e.agent, i) }]);
      return;
    }
    if (e.k === 'dispatch' && e.role) {
      const at = outAt(e, i);
      const { rounds, outcome } = effect(e.role, at);
      for (const o of outcome) {
        if (o.closes) close(o.source);
        if (o.fixed) lastFix.set(o.source, at);
        for (const v of pending.get(o.source) ?? []) if (!o.keep.includes(v)) spent.add(v.completion);
        pending.set(o.source, o.keep);
        for (const [key, issue] of o.adopted) streak.set(key, issue);
        for (const key of o.blinded) streak.set(key, { ...streak.get(key), blind: true });
      }
      for (const r of rounds) {
        streak.set(r.key, { n: r.edgeRound, agents: r.agents, at: r.at, blind: r.blind });
        for (const issue of r.issues ?? []) streak.set(`${r.key}|${issue.id}`, { n: issue.round, edge: r.edgeRound });
        made.push({ ...r, at: e.at });
      }
    }
  });
  return { effect: (to) => effect(to, entries.length), rounds: made };
}

/**
 * The rounds a dispatch to `target` would make, one per capped edge into it with a live loop-back routed to it.
 *
 * @param {object[]} entries - The ledger, oldest first.
 * @param {string} target - The stage about to be dispatched.
 * @param {ReturnType<typeof loopEdges>} loops - The capped loop-back edges.
 * @param {Map<string, Set<string>>} [forward] - Stage → the sources that hand passing work on to it.
 * @returns {{source: string, target: string, token: string, round: number, max: number, edgeRound: number,
 *   ceiling: number, agents: string[], issue?: string, issues?: {id: string, round: number}[]}[]}
 */
export function roundsFor(entries, target, loops, forward) {
  return replay(entries, loops, forward).effect(target).rounds.map(({ key, at, ...round }) => round);
}

/** The stage an agent was dispatched as, for resolving who a SendMessage goes to. */
function roleOf(entries, agent) {
  if (!agent) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].agent === agent && entries[i].role) return entries[i].role;
  }
  return null;
}

/**
 * Who a SendMessage goes to: an agent id the ledger has seen, or — since the tool tells the model to
 * prefer names — a name, which in this pipeline is the stage's own, with or without the ` [ref]` a
 * listing appends.
 *
 * @returns {{agent: string|null, role: string|null}}
 */
function recipient(entries, project, to) {
  const agent = String(to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim() || null;
  const role = roleOf(entries, agent) ?? (agent && project.graph.stages.has(agent) ? agent : null);
  return { agent, role };
}

/** Where this agent's current completion starts in the ledger: after its latest launch. */
function currentLaunch(entries, agent) {
  let at = -1;
  entries.forEach((e, i) => {
    if ((e.k === 'dispatch' || e.k === 'pre') && e.agent === agent) at = i;
  });
  return at;
}

/**
 * The report a subagent handed back in its current completion, read from the tail of its own
 * transcript — for a stop whose last message is a comment written after the handback, when the
 * handback's own hook did not record it.
 *
 * @param {unknown} path - `agent_transcript_path` from the hook input.
 * @returns {string|null}
 */
function handbackIn(path) {
  if (typeof path !== 'string' || !existsSync(path)) return null;
  const size = statSync(path).size;
  const length = Math.min(size, AGENT_TAIL);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  let message = null;
  for (const line of buffer.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const content = row?.message?.content;
    // A new prompt — the resume of a finished agent — starts a new completion; its handback is later.
    if (row?.type === 'user' && (typeof content === 'string' || (Array.isArray(content) && content.some((b) => b?.type === 'text')))) message = null;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name === 'SubagentHandback' && typeof block.input?.message === 'string') message = block.input.message;
    }
  }
  return message;
}

/**
 * Records a stage's verdict for its current completion, unless that completion already has this one —
 * with the issues it named, when it sends work back and named them.
 */
function recordVerdict(path, entries, project, at, { agent, role, report }) {
  const tokens = project.tokens.get(role);
  const verdict = declaredVerdict(report, tokens);
  if (!verdict) return;
  const since = currentLaunch(entries, agent);
  const last = entries.findLastIndex((e) => e.k === 'verdict' && e.agent === agent);
  if (last > since && entries[last].verdict === verdict) return;
  const issues = isLoopBack(verdict) ? declaredIssues(report) : null;
  append(path, { k: 'verdict', at, agent, role, verdict, declared: true, ...(issues?.length ? { issues } : {}) });
}

/** A subagent stopped: record its verdict, from its handback when its last message is a comment. */
function onStop(input, project, path, at) {
  const role = input.agent_type;
  const agent = input.agent_id;
  if (!role || !agent || !project.graph.stages.has(role)) return null;
  const entries = readLedger(path);
  const tokens = project.tokens.get(role);
  const since = currentLaunch(entries, agent);
  const recorded = entries.findLastIndex((e) => e.k === 'verdict' && e.agent === agent) > since;
  if (recorded) return null;
  const report = declaredVerdict(input.last_assistant_message, tokens) ? input.last_assistant_message : handbackIn(input.agent_transcript_path);
  recordVerdict(path, entries, project, at, { agent, role, report });
  return null;
}

/** A tool finished: a stage handed its report back, a dispatch went out, or the owner answered. */
function onPost(input, project, path, at) {
  const tool = input.tool_name;
  if (tool === 'SubagentHandback') {
    // Inside the subagent, so `agent_id` is set: the report exactly as the orchestrator will read it.
    const role = input.agent_type;
    const agent = input.agent_id;
    if (!role || !agent || !project.graph.stages.has(role)) return null;
    recordVerdict(path, readLedger(path), project, at, { agent, role, report: input.tool_input?.message });
    return null;
  }
  // A dispatch made inside a subagent is not the pipeline's: its stages are dispatched by the orchestrator.
  if (input.agent_id) return null;
  if (tool === 'AskUserQuestion') {
    append(path, { k: 'reset', at, why: 'ask' });
    return null;
  }
  if (!DISPATCH.has(tool)) return null;
  const response = input.tool_response && typeof input.tool_response === 'object' ? input.tool_response : {};
  let role;
  let agent;
  if (tool === 'SendMessage') {
    const to = recipient(readLedger(path), project, response.resumedAgentId ?? input.tool_input?.to);
    agent = to.agent;
    role = to.role;
  } else {
    agent = response.agentId ?? null;
    role = input.tool_input?.subagent_type;
  }
  if (!role || !project.graph.stages.has(role)) return null;
  const resumed = tool === 'SendMessage' ? Boolean(response.resumedAgentId) : undefined;
  append(path, { k: 'dispatch', at, role, agent, via: tool, id: input.tool_use_id ?? null, ...(resumed === undefined ? {} : { resumed }) });
  return null;
}

/** How far a round is past what holds it: its issue's cap, or its edge's ceiling. Above zero asks. */
const excess = (r) => Math.max(r.round - r.max, r.edgeRound - r.ceiling);

/**
 * The answer for a dispatch past its cap: Claude Code asks the owner to allow it or not. Allowed, it is
 * one more round, and the next one asks again; refused, the model is told the owner said no, and the
 * router tells it to stop and hand over each round's report.
 */
function confirmation(r) {
  const from = r.agents.length > 0 ? ` The rounds so far came from ${r.agents.join(', ')}.` : '';
  const edge = `${r.source} → ${r.target} (${r.token})`;
  let why = `this would be round ${r.round} on ${edge}, and .claude/graph.md caps that loop at ${r.max}.`;
  if (r.issue && r.round > r.max) {
    why = `this would be round ${r.round} of the issue \`${r.issue}\` on ${edge}, and .claude/graph.md caps that loop at ${r.max}.`;
  } else if (r.issue) {
    why =
      `this would be round ${r.edgeRound} on ${edge} with no approval between them. No issue has passed the cap of ${r.max}, ` +
      'but the edge has gone round more than twice it, and an issue given a new name each round is the one loop a count by issue cannot see.';
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason:
        `NINA loop gate: ${why}${from} ` +
        'Allow it for one more round — the next one asks again — or refuse it, and the model stops to hand you the reports.',
    },
  };
}

/** A dispatch is about to go out: note when, and send the round past its edge's cap to the owner to confirm. */
function onPre(input, project, path, at) {
  if (input.agent_id || !DISPATCH.has(input.tool_name)) return null;
  const entries = readLedger(path);
  const role = input.tool_name === 'SendMessage' ? recipient(entries, project, input.tool_input?.to).role : input.tool_input?.subagent_type;
  if (!role || !project.graph.stages.has(role)) return null;
  // When it went out, whatever the owner decides: joined to its `dispatch` entry by the tool_use id,
  // it is the moment the fixer was sent — which is what a later review has to begin after.
  append(path, { k: 'pre', at, role, id: input.tool_use_id ?? null });
  const over = roundsFor(entries, role, project.loops, project.forward)
    .filter((r) => excess(r) > 0)
    .sort((a, b) => excess(b) - excess(a));
  if (over.length === 0) return null;
  const worst = over[0];
  append(path, {
    k: 'ask',
    at,
    role,
    source: worst.source,
    token: worst.token,
    round: worst.round,
    max: worst.max,
    edge_round: worst.edgeRound,
    ...(worst.issue ? { issue: worst.issue } : {}),
    id: input.tool_use_id ?? null,
  });
  return confirmation(worst);
}

/** Drops a project's ledgers nobody has written to in a month, and error lines older than a week. */
function prune(root, now) {
  const dir = projectGateDir(root);
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl') || file === 'errors.jsonl') continue;
    // Two sessions pruning at once is normal; one of them finding the file gone is not a failure.
    try {
      const path = join(dir, file);
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
    } catch {
      // Already gone.
    }
  }
  const errors = join(dir, 'errors.jsonl');
  if (!existsSync(errors)) return;
  const since = new Date(now.getTime() - KEEP_ERROR_DAYS * 86_400_000).toISOString();
  try {
    const kept = readFileSync(errors, 'utf8').split('\n').filter((line) => line.trim() && String(JSON.parse(line).at) >= since);
    writeFileSync(errors, kept.length ? `${kept.join('\n')}\n` : '');
  } catch {
    // A torn error log is left for the selftest to read as it is.
  }
}

/** Records a failure where `nina gate --selftest` finds it. The gate itself has already let the call through. */
function logError(root, event, error, now) {
  try {
    const file = join(projectGateDir(root), 'errors.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ at: now.toISOString(), event: event ?? null, error: String(error?.message ?? error).slice(0, 300) })}\n`);
  } catch {
    // Nowhere left to say it.
  }
}

/**
 * Handles one hook event: the JSON to print, or null to print nothing. Never throws.
 *
 * @param {object} input - The hook's stdin, parsed.
 * @param {{root: string, now?: Date, pkg?: string}} options - `root` is the project whose pin, graph
 *   and specs are read; `pkg` the NINA install whose releases say whether the pin ships the gate.
 * @returns {object|null}
 */
export function handle(input, { root, now = new Date(), pkg = PACKAGE }) {
  try {
    if (!pinnedShipsGate(root, pkg)) return null;
    const project = loadProject(root);
    if (!project) return null;
    const path = ledgerPath(root, input?.session_id);
    const at = now.toISOString();
    switch (input?.hook_event_name) {
      case 'UserPromptSubmit':
        if (typeof input.prompt === 'string' && DELIVERED.test(input.prompt.slice(0, DELIVERY_HEAD))) return null;
        append(path, { k: 'reset', at, why: 'prompt' });
        prune(root, now);
        return null;
      case 'SubagentStop':
        return onStop(input, project, path, at);
      case 'PostToolUse':
        return onPost(input, project, path, at);
      case 'PreToolUse':
        return onPre(input, project, path, at);
      default:
        return null;
    }
  } catch (error) {
    logError(root, input?.hook_event_name, error, now);
    return null;
  }
}

/**
 * The hook entry point: reads one event from stdin — or, for the selftest's dry run, one per line —
 * and prints each answer there is. Always exits 0: the answer is the JSON, and a hook command ends in
 * `|| true` besides.
 *
 * @param {{root: string, stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream}} options
 * @returns {Promise<number>}
 */
export async function runGate({ root, stdin = process.stdin, stdout = process.stdout }) {
  const chunks = [];
  try {
    for await (const chunk of stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  } catch (error) {
    logError(root, null, error, new Date());
    return 0;
  }
  // Decoded once: a character split across two chunks would otherwise decode as garbage.
  const raw = Buffer.concat(chunks).toString('utf8');
  let events;
  try {
    events = [JSON.parse(raw)];
  } catch {
    try {
      events = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch {
      logError(root, null, `stdin was not a hook event (${raw.length} bytes)`, new Date());
      return 0;
    }
  }
  for (const event of events) {
    const answer = handle(event, { root });
    if (answer) stdout.write(`${JSON.stringify(answer)}\n`);
  }
  return 0;
}
