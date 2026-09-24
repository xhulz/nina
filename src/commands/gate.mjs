/**
 * `nina gate` — the loop gate's own check, and a way to run it by hand.
 *
 *   nina gate --selftest   is the gate wired, has it failed, would it still hold a loop past its cap?
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HARNESS, legacyHint, slugFor } from '../paths.mjs';
import { GATE, hookCommand, missingWiring, shippedScripts } from '../wiring.mjs';
import { loadProject, projectGateDir, readLedger, runGate } from '../gate.mjs';
import { layerRootFor } from './compose.mjs';

/**
 * The gate's failures a person has not been told about yet, as one sentence, or null. Each failure is
 * reported once: a detector that repeats one transient error on every turn for a day is the noise the
 * detectors exist to remove, and the gate's own log keeps the history.
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
    writeFileSync(seenFile, `${last.at}\n`);
  } catch {
    // Unwritable: it is said again next time, which is better than never.
  }
  return (
    `the gate failed ${fresh.length} time(s) since ${fresh[0].at} — the last, on ${last.event ?? 'no event'}: ${last.error}. ` +
    `It lets every call through when it fails, so no cap was held then (${file})`
  );
}

/** Whether the gate can write its ledger here. It lets every call through when it cannot. */
function writable(target) {
  const dir = projectGateDir(target);
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.selftest-${process.pid}`);
    writeFileSync(probe, '');
    rmSync(probe);
    return null;
  } catch (error) {
    return `the gate cannot write its ledger in ${dir} — ${error.message}. It lets every call through when it cannot, so no cap is held`;
  }
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
    for (let i = 1; i <= rounds; i += 1) {
      const agent = `selftest-${n}-${edge.source}-${i}`;
      events.push(...launch(edge.source, `selftest-${n}-review-${i}`, agent));
      events.push({ hook_event_name: 'PostToolUse', session_id: session, tool_name: 'SubagentHandback', agent_id: agent, agent_type: edge.source, tool_input: { message: `VERDICT: ${edge.token}${shape.line(i)}\nthe fix did not hold` } });
      events.push({ hook_event_name: 'SubagentStop', session_id: session, agent_id: agent, agent_type: edge.source, stop_hook_active: false, last_assistant_message: 'done' });
      if (i === rounds) break;
      events.push(...launch(edge.to, `selftest-${n}-fix-${i}`, `selftest-${n}-fixer-${i}`));
    }
    events.push({ hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Agent', tool_input: { subagent_type: edge.to }, tool_use_id: `selftest-${n}-last` });
  }));

  let settings = null;
  try {
    settings = JSON.parse(readFileSync(join(target, '.claude', 'settings.json'), 'utf8'));
  } catch {
    // Reported by the wiring check; the script is run directly instead.
  }
  const command = hookCommand(settings, 'PreToolUse', GATE) ?? `node "${join(target, GATE)}"`;
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
 * @param {string[]} argv - `[--selftest | --hook] [--project <dir>]`.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function gate(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  if (argv.includes('--hook')) return runGate({ root: target });

  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    console.error(`  no ${HARNESS}/profile.json under ${target}${legacyHint(target)}\n`);
    return 2;
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch (error) {
    console.error(`  ${profilePath} is not valid JSON — ${error.message}\n`);
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
  problems.push(...(await missingWiring(target, new Set([GATE]))));
  const cannotWrite = writable(target);
  if (cannotWrite) problems.push(cannotWrite);
  const failing = newErrors(target);
  if (failing) problems.push(failing);
  if (composed) {
    const dry = dryRun(target);
    if (dry) problems.push(dry);
  }

  if (problems.length === 0) {
    console.log(`  wired, writable, no new failure, and a dry run through the hook command sent the round past a cap to the owner — ledgers in ${projectGateDir(target)}`);
    console.log('gate: current');
    return 0;
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`gate: ${problems.length} problem(s)`);
  return 1;
}
