/**
 * Reads Claude Code session transcripts and reconstructs one record per subagent
 * dispatch.
 *
 * Why this exists: the transcripts are the only record of how the pipeline actually
 * behaved — which stage rejected, how often, how long it took — and they are deleted
 * over time. Everything before 2026-09-03 was already gone when this was written.
 *
 * The join: an assistant message carries a `tool_use` block for the Agent tool, whose
 * `id` is echoed back inside the `<task-notification>` that reports the subagent's
 * completion. That id is the only reliable key between the two.
 */

import { createReadStream, existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Root under which Claude Code stores one directory of transcripts per project. */
export const PROJECTS_ROOT = join(homedir(), '.claude', 'projects');

/** The transcript directory of a project, by its snapshot name; `NINA_TRANSCRIPTS` moves the root, for tests. */
export const transcriptsOf = (slug) => join(process.env.NINA_TRANSCRIPTS ?? PROJECTS_ROOT, slug);

/**
 * The verdict tokens the agent specs mandate on a report's first line, per role.
 * A stage that declares its verdict this way is read with certainty; everything
 * below is fallback for reports written before the contract existed.
 */
const DECLARED = /^\s*VERDICT:\s*([A-Z][A-Z-]*)/;

/**
 * Verdict tokens a stage can report, in precedence order. A rejection outranks an
 * approval when both appear, because a report that mentions both is describing a
 * failure it then explains.
 */
const VERDICTS = [
  ['BLOCKED', /\bBLOCKED\b/],
  ['REJECTED', /\b(REJECTED|CHANGES\s+REQUESTED|NOT\s+APPROVED)\b/],
  ['FAIL', /\b(FAIL|FAILED|FAILURE)\b/],
  ['APPROVED', /\bAPPROVED\b/],
  ['SECURE', /\bSECURE\b/],
  ['PASS', /\b(PASS|PASSED|ALL\s+GREEN)\b/],
  // The success tokens of the stages that write rather than judge. Without them the fallback
  // could recover a gate's verdict from a report that skipped the declared line, but never a
  // planner's, an architect's or an implementer's — which is why those three read 84–94%
  // "unreadable" while every gate read 3%. Their loop-back rate was not low; it was unmeasured.
  ['DIFF-READY', /\bDIFF-READY\b/],
  ['SPEC-READY', /\bSPEC-READY\b/],
  ['PLAN-READY', /\bPLAN-READY\b/],
  ['DEPLOYED', /\bDEPLOYED\b/],
];

/**
 * The tokens each role's spec tells it to emit — its own vocabulary, and nothing else.
 *
 * The fallback scan used to try every token of every role, so a report that skipped its declared
 * line was read by whatever word came first. The implementer is instructed to state "typecheck,
 * lint and build: PASS", and PASS is qa's token: an implementer report with no VERDICT line came
 * out as a passing qa run — confidently wrong, which is worse than the "unreadable" it replaced.
 * Scoped to the role, the fallback can only find a verdict that role could have given.
 *
 * This restates what each spec declares, so the CLI suite reads every spec's "`<TOKEN>` is one of"
 * sentence and fails if the two ever disagree — a second copy of a fact is only safe while
 * something checks it against the first.
 */
export const ROLE_TOKENS = {
  planner: ['PLAN-READY', 'BLOCKED'],
  architect: ['SPEC-READY', 'BLOCKED'],
  implementer: ['DIFF-READY', 'BLOCKED'],
  'solidity-dev': ['DIFF-READY', 'BLOCKED'],
  reviewer: ['APPROVED', 'REJECTED'],
  dba: ['APPROVED', 'REJECTED'],
  'integration-tester': ['APPROVED', 'REJECTED'],
  'solidity-auditor': ['APPROVED', 'REJECTED'],
  qa: ['PASS', 'FAIL'],
  devops: ['DEPLOYED', 'BLOCKED'],
  secops: ['SECURE', 'BLOCKED'],
};

/**
 * Classifies a subagent's final report into a verdict.
 *
 * Tries the first non-empty line first, which is where the agent specs mandate the
 * verdict. Falls back to a wider scan, and records which of the two produced the
 * answer so the confidence is visible downstream rather than assumed.
 *
 * @param {string} result - The subagent's final report text.
 * @param {string} [role] - The stage that wrote it. When known, the fallback only looks for that
 *   stage's own tokens; the declared line is always taken as written.
 * @returns {{verdict: string, source: string}} The verdict and how it was found.
 */
export function classifyVerdict(result, role) {
  if (!result) return { verdict: 'NONE', source: 'empty' };
  const firstLine = result.split('\n').find((l) => l.trim().length > 0) ?? '';

  const declared = DECLARED.exec(firstLine);
  if (declared) return { verdict: declared[1], source: 'declared' };

  const own = ROLE_TOKENS[role];
  const candidates = own ? VERDICTS.filter(([name]) => own.includes(name)) : VERDICTS;
  for (const [name, re] of candidates) {
    if (re.test(firstLine)) return { verdict: name, source: 'first-line' };
  }
  const head = result.slice(0, 800);
  for (const [name, re] of candidates) {
    if (re.test(head)) return { verdict: name, source: 'scan' };
  }
  return { verdict: 'UNCLEAR', source: 'none' };
}

/** The tools that write a file, and where each names it. */
const WRITES = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

/** The line under a declared verdict that names what the report sends back. */
const ISSUES = /^\s*ISSUES:(.*)$/;

/** The longest issue id kept, and the most ids kept from one report: labels, never the report. */
const ISSUE_ID_MAX = 40;
const ISSUES_MAX = 20;

/** Ids that say there is nothing to name. */
const NO_ISSUE = new Set(['none', 'na', 'n-a', 'null', 'nil']);

/**
 * The marker of a list item under an `ISSUES:` line left empty — models write a list as bullets as readily
 * as with commas. Only the marker is matched and the item is the rest of the line: a pattern that also
 * captured the item backtracked polynomially on a line of spaces, and reports are a model's output.
 */
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * The issues a report names on the line under its verdict — `ISSUES: missing-null-check, wrong-status`.
 *
 * A loop-back is capped per issue, and whether two rounds are about the same one could not be seen
 * from outside the conversation: the gate counted the edge instead, so a review that found a new
 * problem each round looked exactly like a fix that was not converging. The stage that checks is the
 * one that knows, so it says — the verdict line went from 0% to 100% declared the day it was asked
 * for, and this is the same move. An id is written by the model, so it is read leniently (case,
 * accents, spaces, stray backticks, a bulleted list instead of commas) and kept short; the position
 * is read strictly, like the verdict's — a report that puts another line between the two loses its
 * ids, and the gate counts that round by its edge, as it did before any id existed.
 *
 * @param {unknown} text - A report.
 * @returns {string[]|null} The ids, normalized and without repeats, or null when the report has no
 *   declared verdict or no `ISSUES` line directly under it.
 */
export function declaredIssues(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim());
  if (at < 0 || !DECLARED.test(lines[at])) return null;
  const below = lines.findIndex((l, i) => i > at && l.trim());
  const line = below < 0 ? null : ISSUES.exec(lines[below]);
  if (!line) return null;
  let raw = line[1].split(/[,;]/);
  if (!line[1].trim()) {
    raw = [];
    for (const next of lines.slice(below + 1)) {
      const marker = BULLET.exec(next);
      if (!marker) break;
      raw.push(next.slice(marker[0].length));
    }
  }
  const ids = raw.map((id) =>
    id
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[\s_/]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, ISSUE_ID_MAX)
      .replace(/-$/, ''),
  );
  return [...new Set(ids.filter((id) => id && !NO_ISSUE.has(id)))].slice(0, ISSUES_MAX);
}

/**
 * How many issues a report named, for a snapshot record: a count, never the ids — the record is
 * metadata. Null unless the verdict was declared and sends work back, since only then is the line asked for.
 *
 * @param {string} text - The report.
 * @param {string} verdict - Its verdict, as classified.
 * @param {string} source - How the verdict was found.
 * @returns {number|null}
 */
function issueCount(text, verdict, source) {
  if (source !== 'declared' || !LOOP_BACK.has(verdict)) return null;
  return declaredIssues(text)?.length ?? 0;
}

/** A pill file, as a path fragment: `.claude/pills/<role>/<name>.md` or a glob over a directory. */
const PILL_PATH = /\.claude\/pills\/[^\s"'`;|&)]*/g;

/** Shell commands that put a file's content in front of the agent, as opposed to naming it. */
const DUMPS = /(^|[\s;&|(])(cat|head|tail|sed|awk|less|more|bat|grep)\s/;

/**
 * What one transcript line shows a run doing with its pills: which lessons it READ, and whether it
 * only LISTED the directory.
 *
 * Only a read counts as a read. The first version credited any tool call whose input mentioned a
 * pill path, and an audit against the raw transcripts found what that included: a bare `ls` of the
 * directory with no file opened after it (11% of the runs it credited), and an agent's own `Write`
 * of a spec that merely CITED a pill as evidence. That put the figure at 92% when the runs that
 * actually had a lesson's text in front of them were about 80%. So the call is parsed, and credited
 * by what the tool does: a `Read` of a pill, or a shell command that dumps one (cat, head, sed…),
 * is a read; a `Glob`, a `Grep` or an `ls` is a listing; a `Write`, an `Edit` or anything else is
 * neither, however many pill paths it quotes.
 *
 * @param {string} line - One raw JSONL line from a subagent transcript.
 * @returns {{read: string[], listed: boolean}} `read` holds pill paths relative to `.claude/pills/`,
 *   or `(glob)` for a dump over a pattern; README.md is the format, not a lesson, and never counts.
 */
export function pillReads(line) {
  const none = { read: [], listed: false };
  if (!line.includes('"tool_use"') || !line.includes('.claude/pills/')) return none;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return none;
  }
  const content = row?.message?.content;
  if (!Array.isArray(content)) return none;
  const read = new Set();
  let listed = false;
  const lessonOf = (path) => {
    const rel = path.replace(/^.*?\.claude\/pills\//, '');
    return rel.endsWith('.md') && !rel.endsWith('README.md') ? rel : null;
  };
  for (const block of content) {
    if (block?.type !== 'tool_use') continue;
    const input = block.input ?? {};
    if (block.name === 'Read') {
      const lesson = typeof input.file_path === 'string' && input.file_path.includes('.claude/pills/') ? lessonOf(input.file_path) : null;
      if (lesson) read.add(lesson);
    } else if (block.name === 'Glob' || block.name === 'Grep') {
      if (JSON.stringify(input).includes('.claude/pills')) listed = true;
    } else if (block.name === 'Bash' && typeof input.command === 'string') {
      const paths = input.command.match(PILL_PATH) ?? [];
      if (paths.length === 0) continue;
      if (!DUMPS.test(input.command)) {
        listed = true;
        continue;
      }
      for (const path of paths) {
        if (path.includes('*')) read.add('(glob)');
        else {
          const lesson = lessonOf(path);
          if (lesson) read.add(lesson);
          else listed = true;
        }
      }
    }
  }
  return { read: [...read], listed };
}

/** Verdicts that mean the stage sent work back rather than passing it on. */
const LOOP_BACK = new Set(['REJECTED', 'BLOCKED', 'FAIL', 'FAILED']);

/**
 * True for verdicts that mean the stage sent work back.
 *
 * @param {string} verdict - A verdict token.
 * @returns {boolean} Whether it represents a loop-back.
 */
export const isLoopBack = (verdict) => LOOP_BACK.has(verdict);

/**
 * The run a record is a round of: the dispatch id of its first round. A run is one agent, from the Agent
 * call that started it to the last report it handed back; a round is one pass of it that ends in a report —
 * the dispatch itself, or a `SendMessage` that resumed the agent after it had reported. The first round is
 * recorded under the dispatch's id, and each later one under that id with `#<round>` after it.
 *
 * A record with no id is a run of its own: read as one id they share, every such record would be one run.
 *
 * @param {{dispatch_id?: string}} record - A snapshot record.
 * @returns {string}
 */
export function runOf(record) {
  if (record?.dispatch_id) return String(record.dispatch_id).split('#')[0];
  if (!unnamed.has(record)) {
    named += 1;
    unnamed.set(record, `(unnamed ${named})`);
  }
  return unnamed.get(record);
}

/** An id for each record that has none, for as long as the record is held. */
const unnamed = new WeakMap();
let named = 0;

/**
 * Whether a parsed row of a subagent's transcript is the run handing its report back.
 *
 * @param {object|null} row - A parsed transcript row.
 * @returns {boolean}
 */
const handsBack = (row) =>
  row?.type === 'assistant' && Array.isArray(row.message?.content) && row.message.content.some((b) => b?.type === 'tool_use' && b.name === 'SubagentHandback');

/**
 * Whether a parsed row of a subagent's transcript is something said to the agent, as opposed to a tool's
 * result or a reminder: the prompt that starts a run, or the message that resumes it.
 *
 * @param {object|null} row - A parsed transcript row.
 * @returns {boolean}
 */
const saidToAgent = (row) => {
  if (row?.type !== 'user') return false;
  const content = row.message?.content;
  if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) return false;
  return !textOf(content).trimStart().startsWith('<system-reminder>');
};

/**
 * Tells, line by line, which round of its run each line of a subagent's transcript belongs to. A round
 * ends when the run hands its report back, and the next opens with the next thing said to the agent: a
 * resume is written into the agent's own transcript as a message, and everything after it up to its next
 * handback is that round's. What the agent writes after it reports and before anyone speaks to it again
 * stays in the round it closed; a message that reaches it before it reports is part of the round it is in.
 *
 * The snapshot, the context sent to Langfuse and `learn --deep` all read rounds through this, so the three
 * cannot disagree about where one ends. Only a line that could open a round or close one is parsed.
 *
 * @returns {(line: string) => number} Called on each line in order; returns the round it belongs to.
 */
export function roundsOf() {
  let round = 1;
  let reported = false;
  const parse = (line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  };
  return (line) => {
    if (reported && line.includes('"user"') && saidToAgent(parse(line))) {
      round += 1;
      reported = false;
    }
    if (line.includes('SubagentHandback') && handsBack(parse(line))) reported = true;
    return round;
  };
}

/**
 * Every place a transcript line can carry text.
 *
 * A completion notification has appeared in two shapes: a `user` message whose
 * `message.content` holds the text, and a `queue-operation` line that carries it in a
 * top-level `content` field with no `message` at all. Claude Code 2.1.276 started
 * writing the second one, and reading only the first made a whole day of runs look
 * verdict-less. Search both rather than track which version wrote the line.
 *
 * @param {object} row - A parsed transcript line.
 * @returns {string} Everything textual on it.
 */
function lineText(row) {
  const parts = [textOf(row?.message?.content)];
  if (typeof row?.content === 'string') parts.push(row.content);
  else if (Array.isArray(row?.content)) parts.push(textOf(row.content));
  return parts.filter(Boolean).join('\n');
}

/**
 * Extracts the text of a message's content, which may be a plain string or an array
 * of blocks.
 *
 * @param {unknown} content - The `message.content` field.
 * @returns {string} The concatenated text.
 */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (typeof b === 'string' ? b : (b?.text ?? ''))).join('\n');
}

/**
 * Finds the byte offset of the last complete line in a file.
 *
 * A transcript is appended to while a session runs, so the tail can be a partial line.
 * Resuming from the file's size would swallow that line's remainder; resuming from the
 * last newline re-reads it whole on the next pass.
 *
 * @param {string} file - Path to the file.
 * @param {number} size - Its current size in bytes.
 * @param {string} lastLine - The final line readline yielded.
 * @returns {Promise<number>} The offset to resume from.
 */
async function completeLineOffset(file, size, lastLine) {
  if (size === 0) return 0;
  const handle = await open(file, 'r');
  try {
    const tail = Buffer.alloc(1);
    await handle.read(tail, 0, 1, size - 1);
    if (tail[0] === 0x0a) return size;
  } finally {
    await handle.close();
  }
  return Math.max(0, size - Buffer.byteLength(lastLine, 'utf8'));
}

/**
 * Scans one project's transcripts and returns a record per subagent dispatch.
 *
 * A dispatch may notify more than once (an agent resumed via SendMessage re-notifies
 * under the same id), and every copy of one notification is one result. Where the run
 * handed its reports back, each resume after a report is a round of its own, read from
 * the agent's transcript (`attachAgentDetail`); a run from before the handback keeps
 * its last notification's verdict.
 *
 * Reading is incremental: a per-file byte cursor means a session that has already been
 * captured is not re-read, which matters because this runs from a Stop hook and the
 * transcripts are hundreds of megabytes and growing.
 *
 * @param {string} projectDir - Absolute path to a directory under PROJECTS_ROOT.
 * @param {{cursors?: Record<string, number>, records?: object[]}} [prior] - State from the
 *   previous scan: where each file was left, and the records captured so far.
 * @returns {Promise<{records: object[], cursors: Record<string, number>}>} The full record
 *   set (prior plus new) and the cursors to persist.
 */
export async function scanProject(projectDir, prior = {}) {
  const entries = await readdir(projectDir).catch(() => []);
  const files = entries.filter((f) => f.endsWith('.jsonl')).map((f) => join(projectDir, f));

  /** @type {Map<string, object>} dispatch id → record under construction */
  const dispatches = new Map((prior.records ?? []).map((r) => [r.dispatch_id, { ...r }]));
  /** @type {Set<string>} transcript line uuids already consumed (files overlap) */
  const seen = new Set();
  /** @type {Record<string, number>} file → byte offset already consumed */
  const cursors = { ...(prior.cursors ?? {}) };

  for (const file of files) {
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    // A file that shrank was rotated or replaced; start it over.
    const from = cursors[file] > info.size ? 0 : (cursors[file] ?? 0);
    if (from >= info.size) continue;

    let lastLine = '';
    const rl = createInterface({
      input: createReadStream(file, { start: from }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lastLine = line;
      const isDispatch = line.includes('"subagent_type"');
      const isNotification = line.includes('<task-notification>');
      const isLaunch = line.includes('agentId:');
      const isDenial = line.includes('toolDenialKind') || line.includes('hook error:') || line.includes('Loop cap reached:');
      if (!isDispatch && !isNotification && !isLaunch && !isDenial) continue;

      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.uuid && seen.has(row.uuid)) continue;
      if (row.uuid) seen.add(row.uuid);

      const content = row?.message?.content;

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_use') continue;
          const role = block?.input?.subagent_type;
          if (!role) continue;
          // A dispatch already on record is never re-created. Re-walking bytes already read — a
          // cursor that went back, a --rebuild — used to replace the whole record with a blank one,
          // to be refilled from transcripts that may since have been pruned; the verdict, the
          // duration and every field learned from the subagent's own transcript were lost, and
          // the snapshot then wrote the loss over the only copy of that history.
          if (dispatches.has(block.id)) continue;
          dispatches.set(block.id, {
            dispatch_id: block.id,
            ts: row.timestamp ?? null,
            role,
            desc: block?.input?.description ?? null,
            model: block?.input?.model ?? row?.message?.model ?? null,
            branch: row.gitBranch ?? null,
            session: row.sessionId ?? null,
            verdict: null,
            verdict_source: null,
            issues: null,
            result_ts: null,
            duration_s: null,
            result_chars: null,
            status: null,
            agent_id: null,
            skills: [],
          });
        }
      }

      const text = lineText(row);

      // The launch metadata of a background Agent call carries the agent id, which is
      // the only key into that subagent's own transcript.
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_result') continue;
          const target = dispatches.get(block.tool_use_id);
          if (!target) continue;
          const text = textOf(block.content);
          const agentId = /agentId:\s*([a-f0-9]+)/.exec(text)?.[1];
          if (agentId) target.agent_id = agentId;
          // A dispatch that was denied never ran — the loop gate held it at its cap, another hook or a
          // permission rule refused it, or the person rejected it. Marked, so it is not counted as a run
          // that produced no verdict. Claude Code tags the row itself; the text is the fallback for a
          // version that does not, and it has been written both with and without the hook prefix.
          const trimmed = text.trim();
          if (block.is_error && (row.toolDenialKind || /^PreToolUse:\w+ hook error:/.test(trimmed) || /^Loop cap reached:/.test(trimmed))) {
            target.status = 'denied';
          }
        }
      }

      if (!isNotification) continue;
      const id = /<tool-use-id>(.*?)<\/tool-use-id>/.exec(text)?.[1];
      if (!id) continue;
      const record = dispatches.get(id);
      if (!record) continue;

      const result = /<result>([\s\S]*?)(?:<\/result>|$)/.exec(text)?.[1] ?? '';
      // The same notification read twice is not a second result. It is read twice when bytes are
      // re-walked after a cursor went back, and since Claude Code 2.1.282 one notification is also
      // written up to three times: queued, taken off the queue or absorbed mid-turn, and delivered as a
      // message, each at its own time. The agent's usage block (its time so far) tells a copy from a
      // resume, which has run for longer; a notification without one is told by its time, as before.
      const spentMs = Number(/<duration_ms>(\d+)<\/duration_ms>/.exec(text)?.[1] ?? Number.NaN);
      const timed = Number.isFinite(spentMs);
      if (timed ? record.notified_ms === spentMs : record.result_ts && record.result_ts === (row.timestamp ?? null)) continue;
      if (timed) record.notified_ms = spentMs;
      record.status = /<status>(.*?)<\/status>/.exec(text)?.[1] ?? null;
      // A notification whose run handed its report back says only that: "delivered to you as a
      // message … it is not repeated here". Read for a verdict, it replaced the one the handback
      // declared with none, and since the subagent's transcript had not grown, nothing read it again.
      // Nor does it time the round the handback closed: a resumed run notifies again under the
      // dispatch's id, and taken as the first round's end, that notification stretched the round
      // across every hour the agent sat waiting to be resumed.
      if (String(record.verdict_source ?? '').startsWith('handback')) continue;
      record.result_ts = row.timestamp ?? null;
      const { verdict, source } = classifyVerdict(result, record.role);
      record.result_chars = result.length;
      record.verdict = verdict;
      record.verdict_source = source;
      record.issues = issueCount(result, verdict, source);
      if (record.ts && record.result_ts) {
        record.duration_s = Math.round((Date.parse(record.result_ts) - Date.parse(record.ts)) / 1000);
      }
    }
    cursors[file] = await completeLineOffset(file, info.size, lastLine);
  }

  await attachAgentDetail(projectDir, dispatches);
  const records = [...dispatches.values()].sort((a, b) =>
    String(a.ts).localeCompare(String(b.ts)),
  );
  return { records, cursors };
}

/**
 * Reads each subagent's own transcript for what only it knows: the reports it handed back, the skills
 * it invoked, what it spent, and what it wrote — round by round.
 *
 * The report is the authoritative source for a verdict. Claude Code 2.1.276 moved the
 * hand-off to a `SubagentHandback` tool call, whose `message` is the report itself —
 * before that it arrived as a `<task-notification>` in the parent transcript, and on a
 * live session that notification may not be written at all. Reading the subagent's own
 * file works across both, and is where the mandatory-skill rule can be checked.
 *
 * A run the orchestrator resumed after it reported is recorded as a round per report (`roundsOf`). It
 * used to be one record holding its last verdict, so a reviewer that rejected twice and then approved was
 * one approval: over one project's first two days the gate's ledger held 34 loop-backs where the snapshot
 * held 5, since the orchestrator resumed the same reviewer, architect and implementer through every fix.
 * Each round keeps its own verdict, time, spend, files and skills, so every report reads rounds and none
 * has to know that a run can have more than one.
 *
 * These per-agent transcripts are pruned sooner than the session's own, so the snapshot
 * captures this while it exists.
 *
 * @param {string} projectDir - The project's transcript directory.
 * @param {Map<string, object>} dispatches - Records to enrich, keyed by dispatch id; a run's later rounds
 *   are added to it.
 */
async function attachAgentDetail(projectDir, dispatches) {
  /** @type {Map<string, object[]>} agent id → the dispatches that ran under it, first rounds only */
  const byAgent = new Map();
  for (const record of dispatches.values()) {
    if (!record.agent_id || (record.round ?? 1) !== 1) continue;
    if (!byAgent.has(record.agent_id)) byAgent.set(record.agent_id, []);
    byAgent.get(record.agent_id).push(record);
  }
  if (byAgent.size === 0) return;

  const sessions = (await readdir(projectDir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => join(projectDir, d.name, 'subagents'))
    .filter((d) => existsSync(d));

  for (const dir of sessions) {
    for (const file of await readdir(dir).catch(() => [])) {
      const agentId = /^agent-([a-f0-9]+)\.jsonl$/.exec(file)?.[1];
      const records = agentId && byAgent.get(agentId);
      if (!records) continue;
      const run = records[0];
      const later = [];
      for (let k = 2; dispatches.has(`${run.dispatch_id}#${k}`); k += 1) later.push(dispatches.get(`${run.dispatch_id}#${k}`));
      // A run read in full whose transcript has not grown since has nothing new to say. It was assumed
      // a finished run's transcript never changes, and 14 in 1,389 did: resumed after reporting, with a
      // median 42% of their tokens — and their final verdict — written after the first handback, so the
      // first read froze a partial bill. A run still in flight is read again when its transcript grows;
      // a record from before a field existed is read once more; and one whose transcript is gone is
      // never reached here, so it keeps what it had rather than being dropped, which is what a
      // --rebuild would do to every run older than Claude Code's transcript retention. A round that
      // handed its report back has its verdict from the handback; one whose verdict says otherwise lost
      // it to a notification read after it, and is read once more to get it back. A run from before the
      // handback existed is read once, not on every snapshot: skipping only runs with a handback re-read
      // 744 of one project's 826 in full on every turn, two seconds before the person saw an answer.
      const size = (await stat(join(dir, file)).catch(() => null))?.size ?? null;
      const settled = (r) => r.handed_back === false || String(r.verdict_source ?? '').startsWith('handback');
      // `resumes` is written only by a reader from before rounds, which bills the whole run to its first
      // record. A store both versions wrote to — one project on the old pin, a hook elsewhere on the new —
      // had its runs marked read by the old one and skipped here, their first round billed twice.
      if (
        run.agent_read_bytes === size &&
        !('resumes' in run) &&
        [...records, ...later].every((r) => settled(r) && 'round' in r && 'lessons_read' in r && 'tokens' in r && 'files_touched' in r && 'effort' in r && 'turns' in r && 'prompt_chars' in r)
      ) {
        continue;
      }
      // A run captured before rounds were, holding every round's spend and its last verdict. Its later
      // rounds are marked, so an export that already sent the whole run does not send them again.
      const legacy = !('round' in run) && 'tokens' in run;

      /** What one round did, read into as the transcript goes. */
      const fresh = () => ({
        start: null,
        branch: null,
        skills: new Set(),
        // Lessons this round read, and whether it only listed the directory. Every spec tells its role
        // to read its pills before acting, and until this was counted nothing could say whether one
        // ever had. Only the count is kept, never the path or the content — this record is metadata.
        lessonsRead: new Set(),
        lessonsListed: false,
        handback: null,
        handbackTs: null,
        /**
         * Each API message's final usage, by message id. A streamed message is written once per content
         * block under the same id, and its output count grows until the last copy — summing the rows
         * counted the same input three or four times over.
         */
        usage: new Map(),
        /** The files the round wrote through the edit tools. Only their number is kept. */
        written: new Set(),
        /** The tool calls the round made, by id: over its turns, how many calls each turn sent at once. */
        calls: new Set(),
        /** How long the prompt that opened the round was, in characters; never the prompt. */
        promptChars: null,
      });
      const rounds = [fresh()];
      const roundOf = roundsOf();

      const rl = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
      for await (const line of rl) {
        const n = roundOf(line);
        if (n > rounds.length) {
          // The line that opened the round: the message that resumed the run, and when.
          rounds.push(fresh());
          try {
            const opened = JSON.parse(line);
            rounds[n - 1].start = opened.timestamp ?? null;
            rounds[n - 1].branch = opened.gitBranch ?? null;
          } catch {
            // Unreachable: a line that opens a round was parsed to tell that it does.
          }
        }
        const round = rounds[n - 1];
        if (round.promptChars === null && line.includes('"type":"user"')) {
          try {
            const said = promptOf(JSON.parse(line), n);
            if (said !== null) round.promptChars = said.length;
          } catch {
            // A torn line is not the prompt.
          }
        }
        const hasSkill = line.includes('"Skill"');
        const hasHandback = line.includes('SubagentHandback');
        for (const m of line.matchAll(/"type":"tool_use","id":"([^"]+)"/g)) round.calls.add(m[1]);
        if (/"name":"(Edit|Write|MultiEdit|NotebookEdit)"/.test(line)) {
          try {
            for (const block of JSON.parse(line)?.message?.content ?? []) {
              const path = block?.type === 'tool_use' ? block.input?.[WRITES[block.name]] : null;
              if (typeof path === 'string') round.written.add(path);
            }
          } catch {
            // A torn line loses one edit, not the run's.
          }
        }
        if (line.includes('"usage"')) {
          try {
            const row = JSON.parse(line);
            const message = row?.message;
            const effort = typeof row?.effort === 'string' ? row.effort : null;
            if (message?.id && message.usage) round.usage.set(message.id, { usage: message.usage, model: message.model ?? null, effort });
          } catch {
            // A torn line loses one message's count, not the run's.
          }
        }
        const touched = pillReads(line);
        for (const lesson of touched.read) round.lessonsRead.add(lesson);
        if (touched.listed) round.lessonsListed = true;
        if (!hasSkill && !hasHandback) continue;

        if (hasSkill) {
          for (const m of line.matchAll(/"skill"\s*:\s*"([^"]+)"/g)) round.skills.add(m[1]);
        }
        if (!hasHandback) continue;

        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const content = row?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block?.type !== 'tool_use' || block?.name !== 'SubagentHandback') continue;
          const message = block?.input?.message;
          if (typeof message !== 'string') continue;
          round.handback = message;
          round.handbackTs = row.timestamp ?? null;
        }
      }

      rounds.forEach((round, i) => {
        // A round nothing happened in — something said to the agent after it reported that it never
        // answered — is not a round.
        if (i > 0 && !round.handback && round.usage.size === 0) return;
        const id = `${run.dispatch_id}#${i + 1}`;
        let targets = records;
        if (i > 0) {
          if (!dispatches.has(id)) {
            dispatches.set(id, {
              dispatch_id: id,
              ts: round.start,
              role: run.role,
              desc: run.desc,
              model: run.model,
              branch: round.branch ?? run.branch,
              session: run.session,
              verdict: null,
              verdict_source: null,
              issues: null,
              result_ts: null,
              duration_s: null,
              result_chars: null,
              status: null,
              agent_id: run.agent_id,
              skills: [],
              ...(legacy ? { backfilled: true } : {}),
            });
          }
          targets = [dispatches.get(id)];
        }
        const spent = tokensOf(round.usage);
        const shape = contextOf(round.usage);
        targets.forEach((record, j) => {
          // One transcript, one bill: were two records ever to share an agent, the second would count it again.
          record.tokens = j === 0 ? spent.tokens : null;
          record.turns = shape.turns;
          record.tool_calls = round.calls.size;
          record.context_start = shape.start;
          record.context_peak = shape.peak;
          record.prompt_chars = round.promptChars;
          record.usage_model = spent.model;
          record.effort = spent.effort;
          record.files_touched = round.written.size;
          record.skills = [...round.skills];
          record.lessons_read = round.lessonsRead.size;
          record.lessons_listed = round.lessonsListed;
          record.round = i + 1;
          record.handed_back = Boolean(round.handback);
          record.agent_read = true;
          // Fields a record no longer carries: the first definition of a lesson read, which counted a
          // listing or a citation as one, and the count of resumes, which rounds replaced.
          delete record.pills_read;
          delete record.pills_looked;
          delete record.resumes;
          if (!round.handback) return;
          const { verdict, source } = classifyVerdict(round.handback, record.role);
          record.verdict = verdict;
          record.verdict_source = source === 'declared' ? 'handback' : `handback:${source}`;
          record.issues = issueCount(round.handback, verdict, source);
          record.result_chars = round.handback.length;
          record.status = record.status ?? 'completed';
          record.result_ts = round.handbackTs ?? record.result_ts;
          if (record.ts && record.result_ts) {
            record.duration_s = Math.round((Date.parse(record.result_ts) - Date.parse(record.ts)) / 1000);
          }
        });
      });
      run.agent_read_bytes = size;
    }
  }
}

/**
 * What a round was told, from one transcript row, or null when the row is not it. The dispatch's prompt
 * opens the first round; a later round opens with the message that resumed the run, which Claude Code
 * marks as meta, while a meta row in the first round is a reminder. The snapshot measures it and the
 * Langfuse export sends it, so both read it here.
 *
 * @param {object} row - A parsed transcript row.
 * @param {number} round - The round the row is in, from 1.
 * @returns {string|null}
 */
export function promptOf(row, round) {
  const content = row?.message?.content;
  return row?.type === 'user' && (round > 1 || !row.isMeta) && typeof content === 'string' ? content : null;
}

/**
 * How a round spent its context: how many turns it took, and how large the context each turn re-read was
 * when the round began and at its largest. Every turn is billed the whole context again, so a round that
 * begins where a long one ended — a run resumed for a fix — pays for everything before it on each turn.
 *
 * @param {Map<string, {usage: object}>} usage - Message id → its final usage, in the order the round sent them.
 * @returns {{turns: number, start: number|null, peak: number|null}} Context sizes in tokens.
 */
export function contextOf(usage) {
  const n = (v) => (typeof v === 'number' ? v : 0);
  const sizes = [...usage.values()].map(({ usage: u }) => n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens));
  return { turns: sizes.length, start: sizes[0] ?? null, peak: sizes.length > 0 ? Math.max(...sizes) : null };
}

/**
 * What a run spent, from each of its messages' final usage: tokens by kind, and the model and effort
 * level that most of its messages ran at. Metadata — counts, a model id and a level, never a message.
 *
 * The effort is kept because the model alone did not explain what a stage wrote. Every stage ran at
 * the session's level, and the architect wrote a median 12k tokens on one model at `high` and 90k on
 * the next at `xhigh`, most of it thinking; with only the model on the record, that read as the model.
 *
 * @param {Map<string, {usage: object, model: string|null, effort?: string|null}>} usage - Message id → its final usage.
 * @returns {{tokens: {input: number, output: number, write_5m: number, write_1h: number, read: number}|null, model: string|null, effort: string|null}}
 */
export function tokensOf(usage) {
  if (usage.size === 0) return { tokens: null, model: null, effort: null };
  const tokens = { input: 0, output: 0, write_5m: 0, write_1h: 0, read: 0 };
  const byModel = new Map();
  const byEffort = new Map();
  const n = (v) => (typeof v === 'number' ? v : 0);
  // A fast-mode message is billed at a premium, and a fallback iteration ran on another model than the
  // message names; neither is what the model's list price says, so a run with either is left unpriced.
  let irregular = false;
  for (const { usage: u, model, effort } of usage.values()) {
    if (u.speed === 'fast' || (Array.isArray(u.iterations) && u.iterations.some((it) => it?.type && it.type !== 'message'))) irregular = true;
    tokens.input += n(u.input_tokens);
    tokens.output += n(u.output_tokens);
    tokens.read += n(u.cache_read_input_tokens);
    // The split by TTL, where the transcript has it; otherwise every write is the 5-minute kind.
    const split = u.cache_creation && typeof u.cache_creation === 'object';
    tokens.write_1h += split ? n(u.cache_creation.ephemeral_1h_input_tokens) : 0;
    tokens.write_5m += split ? n(u.cache_creation.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens);
    if (model) byModel.set(model, (byModel.get(model) ?? 0) + 1);
    if (effort) byEffort.set(effort, (byEffort.get(effort) ?? 0) + 1);
  }
  const model = irregular ? null : ([...byModel].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  return { tokens, model, effort: [...byEffort].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
}

/**
 * Lists the project transcript directories, newest activity first.
 *
 * @returns {Promise<{slug: string, dir: string, mtime: number}[]>} The projects found.
 */
export async function listProjects() {
  const slugs = await readdir(PROJECTS_ROOT).catch(() => []);
  const out = [];
  for (const slug of slugs) {
    const dir = join(PROJECTS_ROOT, slug);
    const info = await stat(dir).catch(() => null);
    if (info?.isDirectory()) out.push({ slug, dir, mtime: info.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
