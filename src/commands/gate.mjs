/**
 * `nina gate` — the loop gate's own check, and a way to run it by hand.
 *
 *   nina gate --selftest   is the gate wired, has it failed, would it still hold a loop past its cap?
 *   nina gate --status     the loops a session holds open, and what would close each
 *   nina gate --hook       handle one hook event from stdin, the way the composed script does
 *
 * The gate lets every call through when anything goes wrong, which is right for a hook and makes a
 * broken gate invisible: from inside a session, a pipeline with no stuck loops and a pipeline whose
 * gate stopped working look the same. So every project's `harness:check` runs the selftest, and it asks
 * what nothing else would notice — whether the hooks are there with matchers that reach their tools,
 * whether the gate can write its ledger, whether it has failed since anyone was told, and whether the
 * composed script, run through this project's own hook command over a whole loop, still denies the
 * round past a cap. A first version fed a hand-written ledger straight to the decision, and passed
 * while the hooks that write the ledger had never been exercised at all.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readProfile, slugFor } from '../paths.mjs';
import { GATE, hookCommand, missingWiring, shippedScripts } from '../wiring.mjs';
import { LEDGER_TAIL, ledgerPath, loadProject, loopState, projectGateDir, readLedger, runGate, sessionLedgers } from '../gate.mjs';
import { projectRecords } from '../store.mjs';
import { layerRootFor } from './compose.mjs';
import { handsToModel } from '../detectors.mjs';

/**
 * The gate's failures the model has not been told about yet, as one sentence, or null. Each failure is
 * reported until the prompt hook hands it over, and not after: a detector that repeats one transient
 * error on every turn for a day is the noise the detectors exist to remove, and the gate's own log keeps
 * the history. Spent by the first run that saw it, it was usually spent by the Stop hook, whose line the
 * model never reads, or by a check run by hand.
 *
 * @param {string} target - The project directory.
 * @returns {string|null}
 */
function newErrors(target) {
  const dir = projectGateDir(target);
  const file = join(dir, 'errors.jsonl');
  if (!existsSync(file)) return null;
  const seenFile = join(dir, 'errors.seen');
  const seen = existsSync(seenFile) ? readFileSync(seenFile, 'utf8').trim() : '';
  const fresh = readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        return line.trim() ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    })
    .filter((e) => String(e.at) > seen);
  if (fresh.length === 0) return null;
  const last = fresh.at(-1);
  try {
    if (handsToModel()) writeFileSync(seenFile, `${last.at}\n`);
  } catch {
    // Unwritable: it is said again next time, which is better than never.
  }
  return (
    `the gate failed ${fresh.length} time(s) since ${fresh[0].at} — the last, on ${last.event ?? 'no event'}: ${last.error}. ` +
    `It lets every call through when it fails, so no cap was held then (${file})`
  );
}

/**
 * When this check first ran in the project, kept beside its ledgers: what the pipeline did before then
 * was never the gate's to see, so the live check asks only about what came after.
 */
const SINCE = 'checked-since';

/** Whether the gate can write its ledger here. It lets every call through when it cannot. */
function writable(target) {
  const dir = projectGateDir(target);
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.selftest-${process.pid}`);
    writeFileSync(probe, '');
    rmSync(probe);
    if (!existsSync(join(dir, SINCE))) writeFileSync(join(dir, SINCE), `${new Date().toISOString()}\n`);
    return null;
  } catch (error) {
    return `the gate cannot write its ledger in ${dir} — ${error.message}. It lets every call through when it cannot, so no cap is held`;
  }
}

/** How long after a report the gate is asked whether it saw it: the two are written moments apart. */
const SETTLE_MS = 120_000;

/** Fewer reports than this in a session, and a miss is not yet a pattern. */
const LIVE_SAMPLE = 3;

/**
 * Whether the gate saw what the pipeline actually did — what the dry run cannot answer, since it feeds the
 * gate events written here, in the shape Claude Code sent when they were written. The gate reads fields
 * of what Claude Code sends each hook, and the transcripts it writes have changed shape twice under this
 * harness; were the hooks' payloads to change, the gate would record nothing and let everything through,
 * and the dry run would still pass. So the reports of the last session with enough of them — each round
 * whose first line declares a verdict, as the snapshot read it from the transcripts — are set against the
 * verdicts that session's ledger holds. The gate recording fewer than half of them is a finding.
 *
 * @param {string} target - The project directory.
 * @param {{graph: {stages: Set<string>}, tokens: Map<string, Set<string>>}} project - Its composed graph.
 * @returns {{problem: string}|{compared: number}|{unasked: string}} What the comparison found, how many reports it
 *   compared, or why there was nothing to compare yet — which the selftest used to report as a comparison that passed.
 */
function liveness(target, project) {
  const dir = projectGateDir(target);
  let since;
  try {
    since = readFileSync(join(dir, SINCE), 'utf8').trim();
  } catch {
    return { unasked: 'no session has been measured since the gate was first asked' };
  }
  const now = Date.now();
  const reports = (projectRecords(target) ?? []).filter(
    (r) =>
      r.verdict_source === 'handback' &&
      r.session &&
      project.graph.stages.has(r.role) &&
      project.tokens.get(r.role)?.has(r.verdict) &&
      String(r.result_ts) >= since &&
      now - Date.parse(r.result_ts) > SETTLE_MS,
  );
  const bySession = new Map();
  for (const r of reports) bySession.set(r.session, [...(bySession.get(r.session) ?? []), r]);
  const last = [...bySession.values()]
    .filter((rs) => rs.length >= LIVE_SAMPLE)
    .sort((a, b) => String(a.map((r) => r.result_ts).sort().at(-1)).localeCompare(String(b.map((r) => r.result_ts).sort().at(-1))))
    .at(-1);
  if (!last) return { unasked: `no session since then holds ${LIVE_SAMPLE} reports with a verdict line to compare` };
  const path = ledgerPath(target, last[0].session);
  const entries = readLedger(path);
  // A ledger too large to read whole is read from its tail; what came before the tail is not asked about.
  const from = entries.length > 0 && statSync(path).size > LEDGER_TAIL ? String(entries[0].at) : '';
  const shown = last.filter((r) => String(r.result_ts) >= from).length;
  // Over the window the reports were counted in: verdicts from before it, in a session that spans a change in
  // Claude Code, hid a gate that stopped hearing its hooks after the change.
  const recorded = entries.filter((e) => e.k === 'verdict' && String(e.at) >= since && String(e.at) >= from).length;
  if (shown < LIVE_SAMPLE) return { unasked: `the newest measured session holds ${shown} report(s) with a verdict line, too few to compare` };
  if (recorded * 2 >= shown) return { compared: shown };
  return {
    problem:
      `in session ${last[0].session.slice(0, 8)}, the transcripts show ${shown} report(s) with a verdict line and the gate recorded ${recorded}: ` +
      `Claude Code may have changed what it sends to the hooks, and a loop the gate does not see is not capped (${path})`,
  };
}

/**
 * Runs the gate the way Claude Code runs it — the command in this project's own settings, through
 * `sh` and whatever `node` is on the PATH — over a whole loop in the shapes Claude Code sends: each
 * round's reviewer launched, its report handed back, the stop after it, the fixer launched; and then the
 * round past the cap. Three loops per edge, each of which must stay silent until its last dispatch and
 * send exactly that one to the owner: every report naming the same issue, at the round past the cap;
 * every report naming none, at the same round, counted by the edge; and every report naming a new
 * issue, only at the round past twice the cap — counted per issue each is its first round, so the rounds
 * in between going out unasked is what proves the count by issue is live in the gate this project's
 * hooks actually run, and the last one asking proves the edge's ceiling is. Each loop's answer is read
 * from its own session's ledger, so a shape that asks in place of another cannot pass for it. Runs in a
 * scratch data directory, so no real ledger is touched.
 *
 * @param {string} target - The project directory.
 * @returns {string|null} What went wrong, or null when it held.
 */
function dryRun(target) {
  const project = loadProject(target);
  if (!project) return '.claude/graph.md is not composed, so the gate has no caps to hold — run `nina compose`';
  const edges = [];
  for (const [source, byToken] of project.loops) {
    for (const [token, targets] of byToken) for (const [to, max] of targets) edges.push({ source, token, to, max });
  }
  if (edges.length === 0) return null;

  // Every capped edge, each shape in its own session, all in one run: the first edge alone was a planner
  // loop in every profile, and a dry run that never walks the reviewer's loop proves little about it.
  const shapes = [
    { name: 'same', what: 'a loop naming one issue', rounds: (max) => max + 1, line: () => '\nISSUES: selftest-same-issue', issue: () => 'selftest-same-issue' },
    { name: 'none', what: 'a loop naming no issue', rounds: (max) => max + 1, line: () => '', issue: () => undefined },
    { name: 'new', what: 'a loop naming a new issue each round', rounds: (max) => 2 * max + 1, line: (i) => `\nISSUES: selftest-issue-${i}`, issue: (max) => `selftest-issue-${2 * max + 1}` },
    // Most real rounds after the first resume an agent rather than launch one — 60 of one project's 99
    // dispatches — and whether a message is a resume rests on one field of the tool's response.
    { name: 'resume', what: 'a loop whose rounds resume the same agents', rounds: (max) => max + 1, line: () => '', issue: () => undefined, resume: true },
  ];
  const loops = [];
  const events = [];
  edges.forEach((edge, e) => shapes.forEach((shape) => {
    const n = `${e}-${shape.name}`;
    const session = `selftest-${n}`;
    const rounds = shape.rounds(edge.max);
    loops.push({ edge, shape, session, rounds });
    const launch = (role, id, agent) => [
      { hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Agent', tool_input: { subagent_type: role }, tool_use_id: id },
      { hook_event_name: 'PostToolUse', session_id: session, tool_name: 'Agent', tool_input: { subagent_type: role }, tool_use_id: id, tool_response: { agentId: agent } },
    ];
    const resume = (id, agent) => [
      { hook_event_name: 'PreToolUse', session_id: session, tool_name: 'SendMessage', tool_input: { to: agent }, tool_use_id: id },
      { hook_event_name: 'PostToolUse', session_id: session, tool_name: 'SendMessage', tool_input: { to: agent }, tool_use_id: id, tool_response: { resumedAgentId: agent } },
    ];
    // Launched in the first round, and in a resuming shape resumed in every round after.
    const out = (role, id, agent, first) => (shape.resume && !first ? resume(id, agent) : launch(role, id, agent));
    const fixer = (i) => `selftest-${n}-fixer-${shape.resume ? 1 : i}`;
    for (let i = 1; i <= rounds; i += 1) {
      const agent = `selftest-${n}-${edge.source}-${shape.resume ? 1 : i}`;
      events.push(...out(edge.source, `selftest-${n}-review-${i}`, agent, i === 1));
      events.push({ hook_event_name: 'PostToolUse', session_id: session, tool_name: 'SubagentHandback', agent_id: agent, agent_type: edge.source, tool_input: { message: `VERDICT: ${edge.token}${shape.line(i)}\nthe fix did not hold` } });
      events.push({ hook_event_name: 'SubagentStop', session_id: session, agent_id: agent, agent_type: edge.source, stop_hook_active: false, last_assistant_message: 'done' });
      if (i === rounds) break;
      events.push(...out(edge.to, `selftest-${n}-fix-${i}`, fixer(i), i === 1));
    }
    events.push(
      shape.resume
        ? { hook_event_name: 'PreToolUse', session_id: session, tool_name: 'SendMessage', tool_input: { to: fixer(rounds) }, tool_use_id: `selftest-${n}-last` }
        : { hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Agent', tool_input: { subagent_type: edge.to }, tool_use_id: `selftest-${n}-last` },
    );
  }));

  let settings = null;
  try {
    settings = JSON.parse(readFileSync(join(target, '.claude', 'settings.json'), 'utf8'));
  } catch {
    // Reported by the wiring check; the script is run directly instead.
  }
  const command = hookCommand(settings, 'PreToolUse', GATE) ?? `node "${join(target, GATE)}"`;
  // A hook that runs past its timeout is killed before `finally` can remove its directory; one left by a
  // run an hour gone is such a one, and goes now.
  for (const left of readdirSync(tmpdir()).filter((f) => f.startsWith('nina-gate-'))) {
    try {
      if (Date.now() - statSync(join(tmpdir(), left)).mtimeMs > 3_600_000) rmSync(join(tmpdir(), left), { recursive: true, force: true });
    } catch {
      // Another run's, going as this one looks.
    }
  }
  const data = mkdtempSync(join(tmpdir(), 'nina-gate-'));
  try {
    const run = spawnSync('sh', ['-c', command], {
      cwd: target,
      input: `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: target, NINA_DATA: data },
      timeout: 30_000,
    });
    const answers = String(run.stdout ?? '')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { unreadable: l.slice(0, 120) };
        }
      });
    const ledgers = join(data, 'gate', slugFor(realpathSync(target)));
    const wrong = loops.find(({ edge, shape, session, rounds }) => {
      const asks = readLedger(join(ledgers, `${session}.jsonl`)).filter((x) => x.k === 'ask');
      return asks.length !== 1 || asks[0].edge_round !== rounds || asks[0].issue !== shape.issue(edge.max);
    });
    const asked = answers.filter((a) => a?.hookSpecificOutput?.permissionDecision === 'ask').length;
    if (!wrong && asked === loops.length && answers.length === loops.length) return null;
    const logged = join(ledgers, 'errors.jsonl');
    const why =
      (existsSync(logged) && readFileSync(logged, 'utf8').trim().split('\n').at(-1)) ||
      String(run.stderr || '').trim().split('\n')[0] ||
      (wrong
        ? `on ${wrong.edge.source} → ${wrong.edge.to} (${wrong.edge.token}), ${wrong.shape.what} should reach the owner once, at round ${wrong.rounds}, and did not (exit ${run.status})`
        : `it answered ${answers.length} time(s), ${asked} of them to the owner, where ${loops.length} were expected (exit ${run.status})`);
    return `in a dry run through the hook command, the gate did not hold every capped edge in .claude/graph.md: ${why}`;
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}

/**
 * What the gate holds of one session: its loops, what would close each, and the loop-backs waiting on a fix —
 * the same lines a compaction hands the orchestrator, at any time. The session is the one whose ledger was
 * written last, which is the running one while it dispatches, or the one `--session` names by the start of its id.
 *
 * @param {string} target - The project directory.
 * @param {string|undefined} wanted - The start of a session id, or nothing for the latest.
 * @returns {number} Process exit code.
 */
function loopStatus(target, wanted) {
  const project = loadProject(target);
  if (!project) {
    console.error('  .claude/graph.md is not composed, so the gate has no loops to hold — run `nina compose`\n');
    return 2;
  }
  const { dir, ledgers, picked, why } = sessionLedgers(target, wanted);
  if (ledgers.length === 0 && !wanted) {
    console.log(`  the gate has no ledger here yet: no session has dispatched a stage since it was wired (${dir})`);
    console.log('gate: no open loop');
    return 0;
  }
  if (!picked) {
    console.error(`  ${why} (${dir})\n`);
    return 2;
  }
  const { session, written, path } = picked;
  const state = loopState(project, readLedger(path));
  const others = ledgers.length > 1 ? `; ${ledgers.length - 1} other session(s) kept here, --session <id> for one` : '';
  console.log(`  session ${session}, its ledger last written ${written.toISOString().slice(0, 16).replace('T', ' ')} UTC${others}`);
  for (const line of state.lines) console.log(`  ${line}`);
  const counts = [
    state.open ? `${state.open} open loop(s)` : 'no open loop',
    state.closing ? `${state.closing} settled, dropped at the next dispatch` : '',
    state.waiting ? `${state.waiting} loop-back(s) waiting on a fix` : '',
  ];
  console.log(`gate: ${counts.filter(Boolean).join(', ')}`);
  return 0;
}

/**
 * @param {string[]} argv - `[--selftest | --status [--session <id>] | --hook] [--project <dir>]`.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function gate(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  if (argv.includes('--hook')) return runGate({ root: target });
  if (argv.includes('--status')) return loopStatus(target, argv.includes('--session') ? argv[argv.indexOf('--session') + 1] : undefined);
  if (argv.includes('--session')) {
    console.error('  --session names the session --status reads, and means nothing without it\n');
    return 2;
  }

  const { profile, error } = readProfile(target);
  if (error) {
    console.error(`  ${error}\n`);
    return 2;
  }
  const resolved = layerRootFor(ctx.root, profile.core);
  if (resolved.error) {
    console.error(`  ${resolved.error}\n`);
    return 2;
  }
  if (!(await shippedScripts(resolved.dir, profile.surfaces ?? [])).has(GATE)) {
    console.log(`  core ${profile.core} has no loop gate — its caps are instructions to the orchestrator`);
    console.log('gate: current');
    return 0;
  }

  const problems = [];
  const composed = existsSync(join(target, GATE));
  if (!composed) problems.push(`${GATE} is not composed — run \`nina compose\``);
  const unwired = await missingWiring(target, new Set([GATE]));
  problems.push(...unwired);
  const cannotWrite = writable(target);
  if (cannotWrite) problems.push(cannotWrite);
  const failing = newErrors(target);
  if (failing) problems.push(failing);
  if (composed) {
    const dry = dryRun(target);
    if (dry) problems.push(dry);
  }
  // A gate that is not wired sees nothing, and says so above; asked whether it saw the pipeline, it would
  // say the same thing twice.
  const project = composed && unwired.length === 0 ? loadProject(target) : null;
  const seen = project ? liveness(target, project) : null;
  if (seen?.problem) problems.push(seen.problem);

  if (problems.length === 0) {
    const compared = seen?.compared
      ? `and it recorded the ${seen.compared} reports the transcripts show`
      : `and whether it records what the transcripts show is not asked yet — ${seen?.unasked ?? 'nothing to compare'}`;
    console.log(`  wired, writable, no new failure, a dry run through the hook command sent the round past a cap to the owner, ${compared} — ledgers in ${projectGateDir(target)}`);
    console.log('gate: current');
    return 0;
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`gate: ${problems.length} problem(s)`);
  return 1;
}
