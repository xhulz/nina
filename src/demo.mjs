/**
 * `nina dashboard --demo` — the dashboard on a project that does not exist: for showing someone how NINA works without
 * opening a real project, running Claude or spending a token.
 *
 * A notes app is composed into a scratch directory at the release this package carries, and given three weeks of
 * invented history: each session's transcripts, written the way Claude Code writes them, and today's session through
 * the loop gate's own hook handler. The snapshot then reads the transcripts into the store as it reads any project's.
 * Nothing here writes a ledger entry or a record of its own: a demo built from hand-written JSON would drift from the
 * format the first time either changed, and the test that runs it would still pass (one mechanism per fact). Every
 * word in it — the features, the issues, the reports — is invented, and nothing is read from a real project.
 *
 * `NINA_DATA` and `NINA_TRANSCRIPTS` point into the scratch directory for the rest of the process, so the store, the
 * gate's ledgers and the transcripts every tab and the office read are the demo's; the command's process ends with the
 * demo, which removes the directory.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from './gate.mjs';
import { slugFor } from './paths.mjs';
import { byVersion, composeProject } from './commands/compose.mjs';
import { frontmatter } from './commands/pills.mjs';
import { snapshot } from './commands/snapshot.mjs';

/** The project's name, which the dashboard and the office show. */
export const DEMO_NAME = 'notes';

/** The stages that run beside the reviewer on a designed change's diff: the database gate, since the notes have a table. */
const BESIDE_REVIEW = ['dba'];

/** A minute. */
const MIN = 60_000;

/**
 * How many times faster than it happened the demo's office plays today's session. Squeezed as a replay of a real
 * session is, each agent sat at its desk for three seconds at most, up again before anyone watching had seen it work;
 * at this pace each of today's runs, lasting seven to thirteen minutes, sits there for 20 to 40.
 */
export const DEMO_PACE = 20;

/** How long each of today's runs stays at its desk in the demo's office, in ms: at least, and at most. */
export const DEMO_AT_DESK = [20_000, 40_000];

/** How the demo's office plays (`nina dashboard --demo`): its one session, over and over, at `DEMO_PACE`. */
export const DEMO_OFFICE = { replay: true, loop: true, scale: 1 / DEMO_PACE };

/** A day. */
const DAY = 86_400_000;

/**
 * The release the demo composes: the one this package carries as its own version, or its newest.
 *
 * @param {string} root - The NINA install directory.
 * @returns {string}
 */
function ownRelease(root) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const releases = readdirSync(join(root, 'releases')).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  if (releases.includes(version)) return version;
  return releases.sort(byVersion).at(-1);
}

/** The demo's profile: a notes app with a database and a web page, its vocabulary invented. */
const profileAt = (core) => ({
  core,
  surfaces: ['db', 'frontend'],
  vocabulary: {
    PROJECT: 'Notes',
    OWNER: 'the maintainer',
    API_DIR: 'src/server',
    APP_DIR: 'src/web',
    PKG_SCOPE: '@notes',
    EMITTING_PKGS: '`core`',
    DB_PKG_NAME: '@notes/db',
    TENANT_KEY: 'workspaceId',
    SECRETS_LOCAL: '.dev.vars',
    SECRETS_PROD: "the host's secret store",
    VISUAL_SERVE: 'pnpm dev',
  },
});

/**
 * Two lessons the pipeline wrote: the implementer's, ten days ago, after which the reviewer sent its work back far less
 * often, and the architect's, six days ago. Where each lives, when it was written, and its text.
 *
 * @param {number} now
 * @returns {{path: string, since: number, text: string}[]}
 */
const PILLS = (now) => {
  const ago = (n) => {
    const d = new Date(now - n * DAY);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return [
    {
      path: 'implementer/a-call-that-sets-something-sets-it.md',
      since: now - 10 * DAY,
      text: `---
id: implementer-a-call-that-sets-something-sets-it
applies_to: [implementer]
severity: medium
status: active
date: ${ago(10)}
last_seen: ${ago(3)}
occurrences: 2
trigger: writing a call that sets a flag, a state or a field on a stored row
---
**What went wrong:** an endpoint meant to archive a note flipped the flag, so a second call unarchived it.
**Rule:** a call that sets something sets it: the same call twice leaves the row as once.
**Why:** a retry, a double click and a replayed request all call twice.
**How to apply:** write a test that calls it twice and reads the row after.
source: an invented review, for the demo
`,
    },
    {
      path: 'architect/say-what-a-second-call-does.md',
      since: now - 6 * DAY,
      text: `---
id: architect-say-what-a-second-call-does
applies_to: [architect]
severity: low
status: active
date: ${ago(6)}
occurrences: 1
trigger: specifying an endpoint that changes a stored row
---
**What went wrong:** a spec left open what a second call does, and the design-reviewer sent it back.
**Rule:** a spec that changes a row says what the same call does the second time.
**Why:** the implementer picks one if the spec does not, and the review finds out a round later.
**How to apply:** one line under the endpoint: a second call is a no-op, an error, or a new row.
source: an invented review, for the demo
`,
    },
  ];
};

/** The features of three weeks of invented work, one a task: what the task is called, and what its steps call it. */
const FEATURES = [
  ['Add tags to notes', 'tags'],
  ['Search notes by title', 'title search'],
  ['Share a note by link', 'share link'],
  ['Paginate the notes list', 'pagination'],
  ['Export notes as Markdown', 'Markdown export'],
  ['Pin a note to the top', 'pinning'],
  ['Undo a deleted note', 'undo'],
  ['Show a word count', 'word count'],
  ['Sort notes by date', 'date sort'],
  ['Rename a notebook', 'notebook rename'],
  ['Color a notebook', 'notebook colors'],
  ['Move a note between notebooks', 'note move'],
  ['Restore an old version of a note', 'versions'],
  ['Limit a note to 100 KB', 'size limit'],
];

/** How long each stage works, in minutes, at least and at most. */
const WORKS = {
  planner: [3, 5],
  architect: [8, 14],
  'design-reviewer': [4, 7],
  implementer: [10, 20],
  reviewer: [4, 7],
  dba: [3, 5],
  qa: [3, 6],
};

/** What each stage does in its own transcript, as the office says it: a shell command's description, or a file it works on. */
const TOOLS = {
  planner: [['Read', { file_path: '.claude/architecture.md' }], ['Grep', { pattern: 'notes' }], ['Write', { file_path: '.claude/plans/plan.md' }]],
  architect: [['Read', { file_path: '.claude/architecture.md' }], ['Read', { file_path: 'src/server/notes.ts' }], ['Bash', { description: 'Check how the notes table is indexed' }], ['Write', { file_path: '.claude/plans/specs/spec.md' }]],
  'design-reviewer': [['Read', { file_path: '.claude/plans/specs/spec.md' }], ['Bash', { description: 'Try the spec on a second call' }]],
  implementer: [['Read', { file_path: '.claude/plans/specs/spec.md' }], ['Edit', { file_path: 'src/server/notes.ts' }], ['Edit', { file_path: 'src/server/notes.test.ts' }], ['Bash', { description: 'Run the typecheck' }], ['Bash', { description: 'Run the mutations on a copy' }]],
  reviewer: [['Bash', { description: 'Show the diff' }], ['Read', { file_path: 'src/server/notes.ts' }], ['Bash', { description: 'Run the lint' }]],
  dba: [['Read', { file_path: 'src/server/db/schema.ts' }], ['Bash', { description: 'Read the migration the change adds' }]],
  qa: [['Bash', { description: 'Run the notes tests' }], ['Bash', { description: 'Run the whole suite once' }]],
};

/** Tokens a run writes, in thousands, at least and at most; what it reads back from its cache is ten to forty times that. */
const WRITES = { planner: [2, 5], architect: [12, 30], 'design-reviewer': [4, 9], implementer: [10, 25], reviewer: [5, 12], dba: [2, 5], qa: [1, 3] };

/**
 * A small generator of numbers that is the same on every run, so the demo, and the test that reads it, never vary.
 *
 * @param {number} seed
 * @returns {() => number} A number in [0, 1).
 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * The runs of one task, from `start`: who works, on what words, when, and what each reports. `sendBack` says which
 * gate sends the work back once; `design` whether it goes through the planner, the architect and the design-reviewer.
 *
 * @returns {{runs: object[], end: number}}
 */
function taskRuns(random, start, { name, noun, design, sendBack = null, between = 0.2, works = null }) {
  const runs = [];
  const slug = noun.toLowerCase().replace(/\s+/g, '-');
  const span = (role) => {
    if (works) return works();
    const [lo, hi] = WORKS[role];
    return Math.round((lo + random() * (hi - lo)) * MIN);
  };
  let at = start;
  const run = (role, desc, report, { from = at, beside = false } = {}) => {
    const r = { role, desc, report, start: from, end: from + span(role) };
    runs.push(r);
    if (!beside) at = r.end + between * MIN;
    return r;
  };
  if (design) {
    run('planner', name, 'VERDICT: PLAN-READY\n\nTwo steps: the endpoint, then the list.');
    run('architect', `Spec the ${noun}`, 'VERDICT: SPEC-READY\n\nThe design is the question: the design-reviewer reads it first.');
    if (sendBack === 'design-reviewer') {
      run('design-reviewer', `Check the ${noun} design`, `VERDICT: REJECTED\nISSUES: ${slug}-second-call-undefined\n\nThe spec does not say what a second call does.`);
      run('architect', `Correct the ${noun} spec`, 'VERDICT: SPEC-READY\n\nA second call is now a no-op, and a case reads it.');
    }
    run('design-reviewer', `Check the ${noun} design`, 'VERDICT: APPROVED\n\nThe design holds.');
  }
  run('implementer', design ? `Build the ${noun}` : name, 'VERDICT: DIFF-READY\n\nThe change and its tests, each with the mutation that turns it red.');
  // The reviewer and the gates beside it go out together on the diff, and qa once each has approved.
  const review = (round) => {
    const from = at;
    const sent = sendBack === 'reviewer' && round === 1;
    const reviewer = run('reviewer', round === 1 ? `Review the ${noun} change` : `Review the ${noun} fix`, sent ? `VERDICT: REJECTED\nISSUES: ${slug}-not-idempotent\n\nA second call undoes the first.` : 'VERDICT: APPROVED\n\nThe diff matches its spec.', { from, beside: true });
    const gates = round === 1 && design ? BESIDE_REVIEW.map((role) => run(role, `Check the ${noun} migration`, 'VERDICT: APPROVED\n\nThe migration is additive and indexed.', { from, beside: true })) : [];
    at = Math.max(reviewer.end, ...gates.map((g) => g.end)) + between * MIN;
    return sent;
  };
  if (review(1)) {
    run('implementer', `Fix the ${noun} second call`, 'VERDICT: DIFF-READY\n\nA second call is a no-op now, and a test calls it twice.');
    review(2);
  }
  if (sendBack === 'qa') {
    run('qa', `Test the ${noun}`, `VERDICT: FAIL\nISSUES: ${slug}-test-order\n\nOne test reads a row another wrote.`);
    run('implementer', `Fix the ${noun} test order`, 'VERDICT: DIFF-READY\n\nEach test makes its own rows.');
  }
  run('qa', `Test the ${noun}`, 'VERDICT: PASS\n\nThe tests the diff touches pass, and the suite once.');
  return { runs, end: at };
}

/**
 * Three weeks of invented sessions, and today's: each a list of runs. Today's is the one the office plays. Its first
 * task goes the whole way, sent back once by the reviewer while the database gate approves beside it; its second
 * starts while the first one's qa is at work, so two pieces of work are on the floor at once.
 *
 * @param {number} now - The moment the demo is made; today's last report came in three minutes before it.
 * @returns {{id: string, prompt: string, at: number, runs: object[], asked?: [number, number]}[]}
 */
export function demoSessions(now) {
  const random = seeded(2026);
  const sessions = [];
  const days = [21, 20, 19, 18, 17, 15, 14, 13, 12, 11, 9, 8, 7, 6, 5, 3, 2, 1];
  let feature = 0;
  for (const back of days) {
    const morning = new Date(now - back * DAY);
    morning.setHours(9 + Math.floor(random() * 3), Math.floor(random() * 60), 0, 0);
    const runs = [];
    let at = morning.getTime();
    for (let n = 0; n < 1 + Math.floor(random() * 3); n += 1) {
      const [name, noun] = FEATURES[feature % FEATURES.length];
      feature += 1;
      // The reviewer sent the implementer's work back more than half the time before its lesson, ten days ago, and seldom after.
      const roll = random();
      const sendBack = roll < (back > 10 ? 0.6 : 0.1) ? 'reviewer' : roll > 0.92 ? 'qa' : roll > 0.85 ? 'design-reviewer' : null;
      const task = taskRuns(random, at, { name, noun, design: random() < 0.7 || sendBack === 'design-reviewer', sendBack });
      runs.push(...task.runs);
      at = task.end + (5 + random() * 20) * MIN;
    }
    sessions.push({ id: sessionId(random), prompt: 'Next feature, please.', at: morning.getTime() - MIN, runs });
  }
  // Today's: the archive, sent back once, and the list's dates, begun while the archive's tests run. Each run lasts what
  // sits it at its desk for 20 to 40 seconds of the office's replay. Laid out from zero, then moved so its last report
  // came in three minutes ago: nothing in it happens after `now`.
  const desk = seeded(13);
  const works = () => Math.round((DEMO_AT_DESK[0] + desk() * (DEMO_AT_DESK[1] - DEMO_AT_DESK[0])) * DEMO_PACE);
  const archive = taskRuns(seeded(7), MIN, { name: 'Add archiving to notes', noun: 'archive', design: true, sendBack: 'reviewer', works });
  const qa = archive.runs.at(-1);
  const dates = taskRuns(seeded(11), qa.start + 1.5 * MIN, { name: 'Fix the dates on the notes list', noun: 'list dates', design: false, works });
  const runs = [...archive.runs, ...dates.runs].sort((a, b) => a.start - b.start);
  const shift = now - 3 * MIN - Math.max(...runs.map((r) => r.end));
  for (const r of runs) Object.assign(r, { start: r.start + shift, end: r.end + shift });
  const planned = archive.runs[0];
  sessions.push({
    id: sessionId(random),
    prompt: 'Add archiving to notes, and fix the dates on the list.',
    at: shift,
    runs,
    // The orchestrator asks the owner which of the planner's two steps goes first, and is answered before the architect goes.
    asked: [planned.end + 0.05 * MIN, planned.end + 0.15 * MIN],
  });
  return sessions;
}

/** A session's id, shaped as Claude Code's are. */
function sessionId(random) {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** An agent's id, as hexadecimal as Claude Code's, which the transcript parser reads by that. */
const agentId = (random) => `a${Array.from({ length: 16 }, () => Math.floor(random() * 16).toString(16)).join('')}`;

/** What a stage runs on: the model and effort its composed spec names. */
function ranOn(project, role) {
  const fields = frontmatter(readFileSync(join(project, '.claude', 'agents', `${role}.md`), 'utf8')) ?? {};
  return { model: fields.model ?? null, effort: fields.effort ?? null };
}

/**
 * Writes one session as Claude Code writes it: the orchestrator's transcript, with each dispatch launched in the
 * background and its notification when it ends, and each run's own transcript under `subagents/`, with its tool
 * calls, what each message spent, and the report it handed back.
 */
function writeTranscripts(dir, project, session, random, pills) {
  const stamp = (t) => new Date(t).toISOString();
  const main = [];
  const row = (fields) => main.push({ ...fields, cwd: project, sessionId: session.id, version: '2.1.312' });
  row({ type: 'user', uuid: `${session.id}-u0`, timestamp: stamp(session.at), message: { role: 'user', content: session.prompt } });
  const subagents = join(dir, session.id, 'subagents');
  mkdirSync(subagents, { recursive: true });
  for (const [i, run] of session.runs.entries()) {
    run.toolUseId = `toolu_${session.id.slice(0, 8)}${String(i).padStart(3, '0')}`;
    run.agent = agentId(random);
    row({ type: 'assistant', uuid: `${run.toolUseId}-d`, timestamp: stamp(run.start), message: { role: 'assistant', content: [{ type: 'tool_use', id: run.toolUseId, name: 'Agent', input: { subagent_type: run.role, description: run.desc, prompt: `${run.desc}.`, run_in_background: true } }] } });
    row({ type: 'user', uuid: `${run.toolUseId}-l`, timestamp: stamp(run.start + 1000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: run.toolUseId, content: `Async agent launched successfully.\nagentId: ${run.agent}` }] } });
    row({
      type: 'user',
      uuid: `${run.toolUseId}-n`,
      timestamp: stamp(run.end + 2000),
      message: { role: 'user', content: `<task-notification>\n<task-id>${run.agent}</task-id>\n<tool-use-id>${run.toolUseId}</tool-use-id>\n<status>completed</status>\n<result>${run.report}</result>\n<duration_ms>${run.end - run.start}</duration_ms>\n</task-notification>` },
    });

    const { model, effort } = ranOn(project, run.role);
    // Each stage opens the lessons its directory held when it was dispatched, as its spec tells it to.
    const lessons = pills.filter((p) => p.path.startsWith(`${run.role}/`) && p.since <= run.start).map((p) => ['Read', { file_path: join(project, '.claude', 'pills', p.path) }]);
    const tools = [...lessons, ...TOOLS[run.role]];
    const [lo, hi] = WRITES[run.role];
    const written = Math.round((lo + random() * (hi - lo)) * 1000);
    const steps = tools.length + 1;
    const own = [{ type: 'user', uuid: `${run.agent}-p`, timestamp: stamp(run.start), agentId: run.agent, sessionId: session.id, message: { role: 'user', content: `${run.desc}.` } }];
    const said = (k, content, share) => {
      const usage = { input_tokens: 4 + k, output_tokens: Math.round(written * share), cache_read_input_tokens: Math.round(written * (8 + random() * 24) * share), cache_creation_input_tokens: Math.round(written * (0.5 + random()) * share) };
      own.push({ type: 'assistant', uuid: `${run.agent}-m${k}`, timestamp: stamp(run.start + ((run.end - run.start) * (k + 1)) / (steps + 1)), agentId: run.agent, sessionId: session.id, effort, message: { id: `msg_${run.agent}${k}`, role: 'assistant', model, usage, content } });
    };
    tools.forEach(([name, input], k) => {
      const lines = name === 'Edit' ? { old_string: 'export {};', new_string: Array.from({ length: 12 + Math.floor(random() * 40) }, (_, n) => `// line ${n + 1}`).join('\n') } : name === 'Write' ? { content: Array.from({ length: 20 + Math.floor(random() * 30) }, (_, n) => `line ${n + 1}`).join('\n') } : {};
      said(k, [{ type: 'tool_use', id: `${run.agent}-t${k}`, name, input: { ...input, ...lines } }], 1 / steps);
    });
    said(tools.length, [{ type: 'tool_use', id: `${run.agent}-h`, name: 'SubagentHandback', input: { message: run.report } }], 1 / steps);
    writeFileSync(join(subagents, `agent-${run.agent}.jsonl`), `${own.map((r) => JSON.stringify(r)).join('\n')}\n`);
    writeFileSync(join(subagents, `agent-${run.agent}.meta.json`), JSON.stringify({ agentType: run.role, toolUseId: run.toolUseId }));
  }
  writeFileSync(join(dir, `${session.id}.jsonl`), `${main.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

/**
 * Today's session through the loop gate, event by event, each at its moment: what its hooks would have been handed.
 * The ledger it writes is the one the office plays.
 */
function throughTheGate(project, session, subagents) {
  const events = [{ at: session.at, input: { hook_event_name: 'UserPromptSubmit', prompt: session.prompt } }];
  if (session.asked) {
    events.push({ at: session.asked[0], input: { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} } });
    events.push({ at: session.asked[1], input: { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: {} } });
  }
  for (const run of session.runs) {
    const tool_input = { subagent_type: run.role, description: run.desc, prompt: `${run.desc}.`, run_in_background: true };
    events.push({ at: run.start, input: { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input, tool_use_id: run.toolUseId } });
    events.push({ at: run.start + 1000, input: { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input, tool_use_id: run.toolUseId, tool_response: { agentId: run.agent, isAsync: true, status: 'async_launched' } } });
    events.push({ at: run.end, input: { hook_event_name: 'PostToolUse', tool_name: 'SubagentHandback', agent_id: run.agent, agent_type: run.role, tool_input: { message: run.report } } });
    events.push({ at: run.end + 500, input: { hook_event_name: 'SubagentStop', agent_id: run.agent, agent_type: run.role, last_assistant_message: 'Handed back.', agent_transcript_path: join(subagents, `agent-${run.agent}.jsonl`), stop_hook_active: false } });
    events.push({ at: run.end + 2000, input: { hook_event_name: 'UserPromptSubmit', prompt: `<task-notification>\n<task-id>${run.agent}</task-id>\n<tool-use-id>${run.toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>` } });
  }
  events.sort((a, b) => a.at - b.at);
  for (const { at, input } of events) handle({ ...input, session_id: session.id }, { root: project, now: new Date(at) });
}

/**
 * Makes the demo: the project, its history, and the environment that points every reader at them.
 *
 * @param {{root: string}} ctx - CLI context: where the releases are.
 * @param {{now?: number}} [options]
 * @returns {Promise<{project: string, dir: string, session: string, remove: () => void}>} `dir` holds all of it, and
 *   `remove` takes it away.
 */
export async function makeDemo(ctx, { now = Date.now() } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nina-demo-')));
  const remove = () => rmSync(dir, { recursive: true, force: true });
  const before = { NINA_DATA: process.env.NINA_DATA, NINA_TRANSCRIPTS: process.env.NINA_TRANSCRIPTS };
  try {
    const project = join(dir, DEMO_NAME);
    const data = join(dir, 'data');
    const transcripts = join(dir, 'transcripts');
    mkdirSync(join(project, '.nina'), { recursive: true });
    writeFileSync(join(project, '.nina', 'profile.json'), `${JSON.stringify(profileAt(ownRelease(ctx.root)), null, 2)}\n`);
    const composed = await composeProject(project, ctx);
    if (composed.error) throw new Error(composed.error);

    const pills = PILLS(now);
    for (const pill of pills) {
      const path = join(project, '.claude', 'pills', pill.path);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, pill.text);
    }

    process.env.NINA_DATA = data;
    process.env.NINA_TRANSCRIPTS = transcripts;
    const slug = slugFor(project);
    const own = join(transcripts, slug);
    mkdirSync(own, { recursive: true });
    const random = seeded(29);
    const sessions = demoSessions(now);
    for (const session of sessions) writeTranscripts(own, project, session, random, pills);
    const today = sessions.at(-1);
    throughTheGate(project, today, join(own, today.id, 'subagents'));
    const captured = await snapshot(['--project', slug, '--exact', '--quiet'], ctx);
    if (captured !== 0) throw new Error('the snapshot could not read the demo');
    return { project, dir, session: today.id, remove };
  } catch (error) {
    // Pointed at a directory about to be gone, every reader after this would find nothing.
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    remove();
    throw error;
  }
}
