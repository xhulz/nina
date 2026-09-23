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
 * under the same id). The last notification wins and `resumes` counts the extras —
 * counting every notification as a separate run inflates the totals roughly fivefold.
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
            result_ts: null,
            duration_s: null,
            result_chars: null,
            resumes: 0,
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
      // The same notification read twice — bytes re-walked after a cursor went back — is not a
      // second result. Taking it as one counted a resume that never happened and replaced a verdict
      // read from the subagent's own transcript with a weaker one guessed from this summary.
      if (record.result_ts && record.result_ts === (row.timestamp ?? null)) continue;
      const { verdict, source } = classifyVerdict(result, record.role);
      if (record.result_ts) record.resumes += 1;
      record.status = /<status>(.*?)<\/status>/.exec(text)?.[1] ?? null;
      record.result_ts = row.timestamp ?? null;
      record.result_chars = result.length;
      record.verdict = verdict;
      record.verdict_source = source;
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
 * Reads each subagent's own transcript for the two things only it knows: the report it
 * handed back, and the skills it invoked.
 *
 * The report is the authoritative source for a verdict. Claude Code 2.1.276 moved the
 * hand-off to a `SubagentHandback` tool call, whose `message` is the report itself —
 * before that it arrived as a `<task-notification>` in the parent transcript, and on a
 * live session that notification may not be written at all. Reading the subagent's own
 * file works across both, and is where the mandatory-skill rule can be checked.
 *
 * These per-agent transcripts are pruned sooner than the session's own, so the snapshot
 * captures this while it exists.
 *
 * @param {string} projectDir - The project's transcript directory.
 * @param {Map<string, object>} dispatches - Records to enrich, keyed by dispatch id.
 */
async function attachAgentDetail(projectDir, dispatches) {
  /** @type {Map<string, object[]>} agent id → the dispatches that ran under it */
  const byAgent = new Map();
  for (const record of dispatches.values()) {
    if (!record.agent_id) continue;
    // A finished run's transcript never changes again, so one read is enough. A run
    // still in flight has no handback yet — come back for it next time. A record read before
    // the record learned a field is read once more, if its transcript is still on disk; if it is
    // not, the record keeps what it had rather than being dropped, which is what a --rebuild
    // would do to every run older than Claude Code's transcript retention.
    if (record.agent_read && 'lessons_read' in record) continue;
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

      const skills = new Set();
      // Lessons this run read, and whether it only listed the directory. Every spec tells its role
      // to read its pills before acting, and until this was counted nothing could say whether one
      // ever had. Only the count is kept, never the path or the content — this record is metadata.
      const lessonsRead = new Set();
      let lessonsListed = false;
      let handback = null;
      let handbackTs = null;

      const rl = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
      for await (const line of rl) {
        const hasSkill = line.includes('"Skill"');
        const hasHandback = line.includes('SubagentHandback');
        const touched = pillReads(line);
        for (const lesson of touched.read) lessonsRead.add(lesson);
        if (touched.listed) lessonsListed = true;
        if (!hasSkill && !hasHandback) continue;

        if (hasSkill) {
          for (const m of line.matchAll(/"skill"\s*:\s*"([^"]+)"/g)) skills.add(m[1]);
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
          handback = message;
          handbackTs = row.timestamp ?? null;
        }
      }

      for (const record of records) {
        record.skills = [...skills];
        record.lessons_read = lessonsRead.size;
        record.lessons_listed = lessonsListed;
        // The first definition, which counted a listing or a citation as a read. Dropped rather
        // than kept beside the new one, so no report can pick up the inflated figure by name.
        delete record.pills_read;
        delete record.pills_looked;
        if (handback) {
          const { verdict, source } = classifyVerdict(handback, record.role);
          record.verdict = verdict;
          record.verdict_source = source === 'declared' ? 'handback' : `handback:${source}`;
          record.result_chars = handback.length;
          record.result_ts = record.result_ts ?? handbackTs;
          if (record.ts && record.result_ts) {
            record.duration_s = Math.round(
              (Date.parse(record.result_ts) - Date.parse(record.ts)) / 1000,
            );
          }
          record.agent_read = true;
        }
      }
    }
  }
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
