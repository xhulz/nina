/**
 * `nina sizes` — each step's forecast against what it landed: the `Size:` line its step file carried before it was
 * built, beside the lines of code its commits added, the rate that measures, and the steps still to land forecast
 * again at it.
 *
 * The architect forecasts each step (`Size: ~N lines in M files`) and splits past the step limit, and until this
 * nothing compared a forecast with what landed. In the project that asked for it, two steps landed about 1.5× their
 * forecasts before a reviewer worked the factor out by hand, and a whole architect run — 28 minutes, 375k tokens —
 * then re-derived the rates from `git diff --numstat` to re-forecast six steps. Measured at each commit, that is a
 * line; and as a detector (`--check`) it speaks when the newest step overran and the steps after it still carry the
 * forecasts made before it landed, so the re-forecast is set off by the data rather than noticed.
 *
 * A step is its file, `.claude/plans/specs/<spec>.step-<n>.md`; its commits are those whose message names the spec and
 * `step <n>`, as the router asks a commit to; what it landed is the lines they added outside the harness's own files.
 *
 *   nina sizes [--project <dir>] [--check]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS } from '../paths.mjs';
import { defaultVocabulary } from '../vocabulary.mjs';
import { amber, bold, dim, pink } from '../look.mjs';

const PACKAGE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Where the architect writes a spec's steps. */
const SPECS = join('.claude', 'plans', 'specs');

/** A landed step past its forecast by more than this sets off the detector. */
export const OVERRUN = 1.25;

/** How many of a spec's newest landed steps its rate is measured over. */
const RATE_OVER = 5;

/** Files a step's commit carries that are not the step's code: the harness's own, and lockfiles. */
const NOT_CODE = /^(\.claude\/|\.nina\/|CLAUDE\.md$)|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/;

/**
 * What a step's implementer wrote in its first round, from the `First round:` line the orchestrator writes in its step
 * file when the step took more than one: the fix rounds after it are the review's, not the forecast's.
 *
 * @param {string} text - A step file.
 * @returns {number|null}
 */
export function firstRoundIn(text) {
  const m = /^[\s>*_-]*First round:[*_ \t]*~?[ \t]*(\d[\d,]*)[ \t]*lines?\b/im.exec(text);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/**
 * The kind a step file says it is, from its `Kind:` line — `new`, `extends`, `tests`, or any one word a project uses:
 * a step is measured by the steps of its kind, where any has landed.
 *
 * @param {string} text - A step file.
 * @returns {string|null}
 */
export function kindIn(text) {
  const m = /^[\s>*_-]*Kind:[*_ \t]*([A-Za-z][\w-]*)/m.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The forecast a step file states, from its `Size:` line.
 *
 * @param {string} text - A step file.
 * @returns {{lines: number, files: number|null}|null}
 */
export function forecastIn(text) {
  const m = /\bSize:[*_\s]*~?\s*(\d[\d,]*)\s*lines?\b([^\n]*)/i.exec(text);
  if (!m) return null;
  const files = /^[^.;]*?\bin\s+(\d+)\s+files?\b/i.exec(m[2]);
  return { lines: Number(m[1].replace(/,/g, '')), files: files ? Number(files[1]) : null };
}

/**
 * What a step file's `Size:` line says when {@link forecastIn} reads no forecast from it, or null when it reads one or
 * the file has no such line. A step whose line was rewritten into prose — "round 1 landed +498/−95 against ~272" — was
 * left out of every rate without a word. The label opens its line, as `Kind:` does: `font-size:` in a step's CSS and a
 * sentence that names the `Size:` line are no line of their own.
 *
 * @param {string} text - A step file.
 * @returns {string|null} The line after `Size:`, shortened.
 */
export function unreadSize(text) {
  if (forecastIn(text)) return null;
  const m = /^[\s>*_-]*Size:[*_ \t]*([^\n]*)/im.exec(text);
  if (!m) return null;
  const said = m[1].trim();
  return said.length > 72 ? `${said.slice(0, 71)}…` : said;
}

/** Runs git in the project, or says it could not. */
function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Many files at many revisions, read by one git process: `<rev>:<path>` → its text, or null where it did not exist.
 * The detector runs on every turn, and a process a version came to most of its second.
 *
 * @param {string} dir
 * @param {string[]} wanted
 * @returns {Map<string, string|null>}
 */
function blobs(dir, wanted) {
  const keys = [...new Set(wanted)];
  const out = new Map(keys.map((k) => [k, null]));
  if (keys.length === 0) return out;
  const r = spawnSync('git', ['-C', dir, 'cat-file', '--batch'], { input: `${keys.join('\n')}\n`, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return out;
  const buffer = r.stdout;
  let at = 0;
  for (const key of keys) {
    const end = buffer.indexOf(10, at);
    if (end === -1) break;
    const header = /^\S+ (\S+) (\d+)$/.exec(buffer.toString('utf8', at, end));
    at = end + 1;
    // `<rev>:<path> missing` carries no body.
    if (!header) continue;
    const size = Number(header[2]);
    if (header[1] === 'blob') out.set(key, buffer.toString('utf8', at, at + size));
    at += size + 1;
  }
  return out;
}

/** Each commit's code: the lines it added to each file that is not the harness's own, read by one git process. */
function codeOf(dir, hashes) {
  const out = new Map(hashes.map((h) => [h, new Map()]));
  if (hashes.length === 0) return out;
  for (const block of (git(dir, ['show', '--no-renames', '--numstat', '--format=%x00%H', ...hashes]) ?? '').split('\0').filter((b) => b.trim())) {
    const [hash, ...rows] = block.split('\n');
    const code = out.get(hash.trim());
    if (!code) continue;
    for (const row of rows) {
      const [added, , path] = row.split('\t');
      if (!path || added === '-' || NOT_CODE.test(path)) continue;
      code.set(path, (code.get(path) ?? 0) + Number(added));
    }
  }
  return out;
}

/** The commits that changed each of these files, newest first, read by one git process. */
function changesTo(dir, paths) {
  const out = new Map(paths.map((p) => [p, []]));
  if (paths.length === 0) return out;
  for (const block of (git(dir, ['log', '--no-renames', '--format=%x00%H%x09%ct', '--name-only', 'HEAD', '--', ...paths]) ?? '').split('\0').filter((b) => b.trim())) {
    const [head, ...names] = block.split('\n');
    const [hash, seconds] = head.split('\t');
    for (const name of names) out.get(name.trim())?.push({ hash, t: Number(seconds) * 1000 });
  }
  return out;
}

/** A text as a pattern that matches it literally. */
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a commit message names this step of this spec: `step 10e2` names neither `step 10e2a` nor `step 10`, and
 * `1.6-spec-c` is not `1.6-spec-c2`. A spec followed by a step, as the router has a commit named (`<spec> step <n>`),
 * names that step and no other the message mentions: one project's commit landed `<spec> step 6` and said "M6 step 7's
 * clause corrected", and was counted a landing of step 7 too. A message whose spec no step follows names any step it
 * mentions, the form older commits took (`1.8 step 1: … (1.8-spike)`).
 */
export function names(subject, spec, step) {
  const whole = '(?![\\w.-]*\\w)';
  if (!new RegExp(`(^|[^\\w.-])${literal(spec)}${whole}`, 'i').test(subject)) return false;
  const followed = [...subject.matchAll(new RegExp(`(?:^|[^\\w.-])${literal(spec)}[\\s:,]+step[\\s-]+([\\w.-]*\\w)`, 'gi'))];
  if (followed.length) return followed.some((m) => m[1].toLowerCase() === step.toLowerCase());
  return new RegExp(`\\bstep[\\s-]+${literal(step)}${whole}`, 'i').test(subject);
}

/** The step files in the working tree, as `{path, spec, step}`, in their natural order. */
function stepFiles(dir) {
  const root = join(dir, SPECS);
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { recursive: true })) {
    const m = /^(.*)\.step-([^/\\]+)\.md$/.exec(String(entry).split(/[/\\]/).at(-1));
    if (!m) continue;
    out.push({ path: relative(dir, join(root, String(entry))).split(/[/\\]/).join('/'), spec: m[1], step: m[2] });
  }
  return out.sort((a, b) => a.spec.localeCompare(b.spec) || a.step.localeCompare(b.step, undefined, { numeric: true }));
}

/** The middle value. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Every step with a forecast, landed or not: what it was forecast before it was built, and what its commits added.
 *
 * @param {string} dir - The project.
 * @returns {{steps: object[], limit: number, unread: object[]}|null} Null outside a git repository. `unread` is each step
 *   file whose `Size:` line reads as no forecast, with what it says (`said`).
 */
export function measure(dir) {
  const profile = (() => {
    try {
      return JSON.parse(readFileSync(join(dir, HARNESS, 'profile.json'), 'utf8'));
    } catch {
      return {};
    }
  })();
  const limit = Number(profile?.vocabulary?.STEP_LINES) || Number(defaultVocabulary(PACKAGE).STEP_LINES) || 400;
  // It runs every turn: a project with no step file does not pay for its history.
  const files = stepFiles(dir);
  if (files.length === 0) return git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']) === null ? null : { steps: [], limit, unread: [] };
  const log = git(dir, ['log', '--format=%H%x09%ct%x09%cI%x09%s', 'HEAD']);
  if (log === null) return null;
  // Times as instants: an ISO time carries its zone, and two zones compared as text order wrongly.
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [hash, seconds, at, ...rest] = row.split('\t');
      return { hash, t: Number(seconds) * 1000, at, subject: rest.join('\t') };
    })
    .reverse();
  const order = new Map(commits.map((c, i) => [c.hash, i]));
  const named = new Map(files.map((f) => [f.path, commits.filter((c) => names(c.subject, f.spec, f.step))]));
  const code = codeOf(dir, [...new Set([...named.values()].flat().map((c) => c.hash))]);
  const changes = changesTo(dir, files.map((f) => f.path));
  const wanted = [];
  for (const f of files) {
    wanted.push(`HEAD:${f.path}`);
    for (const c of changes.get(f.path)) wanted.push(`${c.hash}:${f.path}`);
    for (const c of named.get(f.path)) wanted.push(`${c.hash}^:${f.path}`, `${c.hash}:${f.path}`);
  }
  const text = blobs(dir, wanted);
  const at = (rev, path) => forecastIn(text.get(`${rev}:${path}`) ?? '');
  // When a forecast was written: the oldest commit of the newest run, before a point in history, that carried it. An
  // edit to the rest of the step file is not a forecast. Null where no commit is found to carry it.
  const writtenAt = (path, before, lines) => {
    let when = null;
    for (const c of changes.get(path)) {
      if ((order.get(c.hash) ?? -1) >= before) continue;
      if (at(c.hash, path)?.lines !== lines) break;
      when = c.t;
    }
    return when;
  };
  const steps = [];
  // Step files whose `Size:` line reads as no forecast: left out of every rate, so said rather than skipped.
  const unread = [];
  for (const file of files) {
    const current = readFileSync(join(dir, file.path), 'utf8');
    const now = forecastIn(current);
    const kind = kindIn(current);
    const landings = named.get(file.path).filter((c) => code.get(c.hash)?.size > 0);
    if (landings.length === 0) {
      if (!now) {
        const said = unreadSize(current);
        if (said !== null) unread.push({ ...file, landed: false, said });
        continue;
      }
      // Forecast again in the working tree, it is newer than every commit.
      const since = at('HEAD', file.path)?.lines === now.lines ? writtenAt(file.path, Infinity, now.lines) : Infinity;
      // What it was first forecast at: a forecast restated at a rate carries that rate over it, and rates multiplied
      // onto one another — another kind's among them — put one project's steps at ×2.54 of their count.
      const original = changes.get(file.path).map((c) => at(c.hash, file.path)).filter(Boolean).at(-1) ?? null;
      steps.push({ ...file, kind, landed: false, forecast: now, since, original: original && original.lines !== now.lines ? original : null });
      continue;
    }
    // The forecast the step was built to: its file before its first commit, or as that commit wrote it.
    const first = landings[0];
    const before = at(`${first.hash}^`, file.path);
    const forecast = before ?? at(first.hash, file.path);
    if (!forecast) {
      const said = unreadSize(text.get(`${first.hash}^:${file.path}`) ?? '') ?? unreadSize(text.get(`${first.hash}:${file.path}`) ?? '');
      if (said !== null) unread.push({ ...file, landed: true, said, hash: first.hash });
      continue;
    }
    const since = (before ? writtenAt(file.path, order.get(first.hash), forecast.lines) : null) ?? first.t;
    const lines = new Map();
    for (const c of landings) for (const [path, added] of code.get(c.hash)) lines.set(path, (lines.get(path) ?? 0) + added);
    const total = [...lines.values()].reduce((a, n) => a + n, 0);
    const last = landings.at(-1);
    // A forecast changed while the step was built — a fix round's spec — is shown, and the step measured against the first.
    const revised = at(last.hash, file.path);
    const firstRound = firstRoundIn(current);
    const ratio = total / forecast.lines;
    steps.push({
      ...file,
      kind,
      landed: true,
      forecast,
      revised: revised && revised.lines !== forecast.lines ? revised : null,
      since,
      lines: total,
      files: lines.size,
      ratio,
      first: firstRound,
      // What the forecast missed by: its first round where the step file says it, so fix rounds do not compound into
      // the rate one correction-heavy step at a time.
      measured: firstRound === null ? ratio : firstRound / forecast.lines,
      t: last.t,
      at: last.at,
      hash: last.hash,
    });
  }
  return { steps, limit, unread };
}

/**
 * The rate to forecast a step again at: the median of what its spec's newest landed steps forecast no earlier than it
 * missed by (`measured`), over the steps of its kind where any has landed. A step forecast before the last re-forecast
 * was measured against the old rates, which that re-forecast already corrected for, and counting it would correct for
 * them twice; and a new module's rate put on steps that extend an existing file asked one project for six splits.
 *
 * @param {object[]} steps
 * @param {{spec: string, since?: string, kind?: string|null}} step - Its spec, when its own forecast was written, its kind.
 * @returns {{rate: number, over: number, kind: string|null}|null}
 */
export function rateOf(steps, { spec, since, kind = null }) {
  // A forecast not known to be written when is measured by nothing, rather than by everything.
  if (since === null || since === undefined) return null;
  const landed = steps.filter((s) => s.landed && s.spec === spec && s.since >= since).sort((a, b) => a.t - b.t);
  const mine = kind ? landed.filter((s) => s.kind === kind) : [];
  const over = (mine.length ? mine : landed).slice(-RATE_OVER);
  return over.length ? { rate: median(over.map((s) => s.measured ?? s.ratio)), over: over.length, kind: mine.length ? kind : null } : null;
}

/**
 * What a spec's newest landed steps of one kind missed by, whenever they were forecast: set beside a step to land that
 * carries more over its first forecast than its kind ever missed by, which reads as rates carried from elsewhere.
 *
 * @param {object[]} steps
 * @param {{spec: string, kind?: string|null}} step - Its spec and kind.
 * @returns {number|null}
 */
export function kindRate(steps, { spec, kind = null }) {
  if (!kind) return null;
  const over = steps.filter((s) => s.landed && s.spec === spec && s.kind === kind).sort((a, b) => a.t - b.t).slice(-RATE_OVER);
  return over.length ? median(over.map((s) => s.measured ?? s.ratio)) : null;
}

/**
 * What the detector says: the newest landed step, when it overran, and the steps of its spec still forecast as they
 * were when it landed — until one of them is forecast again. The next step to go out is forecast again at its turn, and
 * the rest at theirs: asked for every one at once, one project was asked for twenty splits of steps three or more
 * steps away, which later steps would each have measured again.
 *
 * @param {{steps: object[]}} measured
 * @returns {{step: object, rate: {rate: number, over: number, kind: string|null}, stale: object[]}|null}
 */
export function overrun({ steps }) {
  const newest = steps.filter((s) => s.landed).sort((a, b) => a.t - b.t).at(-1);
  if (!newest || newest.measured <= OVERRUN) return null;
  const mine = steps.filter((s) => !s.landed && s.spec === newest.spec && s.since !== null);
  // A step forecast since it landed is the one about to go out, forecast at its turn: the overrun was acted on.
  if (mine.some((s) => s.since > newest.t)) return null;
  // Forecast no later than the overrun step was, so its rate measures them: forecast again since, they are not stale.
  const stale = mine.filter((s) => s.since <= newest.since);
  return stale.length ? { step: newest, rate: rateOf(steps, stale[0]), stale } : null;
}

const times = (x) => `×${x.toFixed(2)}`;

/**
 * `nina sizes`.
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function sizes(argv) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const dir = resolve(arg('--project') ?? '.');
  const check = argv.includes('--check');
  if (!existsSync(join(dir, HARNESS, 'profile.json'))) {
    console.error(`  no ${HARNESS}/profile.json under ${dir} — run it inside a project, or name one with --project\n`);
    return check ? 0 : 1;
  }
  const measured = measure(dir);
  if (measured === null) {
    if (check) console.log('sizes: current');
    else console.error('  not a git repository, or one with no commit yet: a step is measured by its commits\n');
    return check ? 0 : 1;
  }
  const { steps, limit, unread } = measured;
  if (check) {
    // During `nina upgrade --apply`: a step that overran is the project's history, not the move — and the release that
    // first shipped this detector rolled itself back in the project that asked for it. The move says it after.
    if (process.env.NINA_UPGRADE) {
      console.log('sizes: current');
      return 0;
    }
    const said = [];
    const found = overrun(measured);
    if (found) {
      const { step, stale } = found;
      const again = stale.slice(0, 4).map((s) => {
        const rate = rateOf(steps, s);
        const next = Math.round(s.forecast.lines * (rate?.rate ?? 1));
        return `${s.step} ~${s.forecast.lines} → ~${next}${rate?.kind ? ` (${rate.kind})` : ''}${next > limit ? ` past ${limit}` : ''}`;
      });
      const first = step.first === null ? '' : `, ${step.first} in its first round (${times(step.measured)})`;
      said.push(
        `step ${step.step} of ${step.spec} landed ${step.lines} lines against ~${step.forecast.lines} (${times(step.ratio)}${first}); ` +
          `before the next of its ${stale.length} step(s) forecast when it was goes out, forecast that one again — a \`Size:\` line at the rate \`nina sizes\` gives it — ` +
          `and split it if that puts it past ${limit}; the rest at their turn: ${again.join(', ')}${stale.length > again.length ? ', …' : ''}`,
      );
    }
    // Only a step still to land: its line can be written again now, and once it lands, the line it carried is history.
    for (const u of unread.filter((x) => !x.landed)) {
      // "~215 raw lines" opens with a number too: what reads is the forecast it is measured by, followed by `lines`.
      said.push(`step ${u.step} of ${u.spec}: no forecast it can read in its \`Size:\` line ("${u.said}") — write it as \`Size: ~N lines in M files\`, the forecast the step is measured by followed by \`lines\`, before the step lands, or no rate counts it`);
    }
    if (said.length === 0) {
      console.log('sizes: current');
      return 0;
    }
    for (const line of said) console.log(line);
    return 1;
  }
  if (steps.length === 0 && unread.length === 0) {
    console.log(`  no step file under ${SPECS} states a \`Size:\` line yet\n`);
    return 0;
  }
  // What a step to land carries over its first forecast, beside what its kind's landed steps missed by: rates multiplied
  // onto one another, another kind's among them, read as one step's own.
  const carried = (s) => {
    if (!s.original) return '';
    const factor = s.forecast.lines / s.original.lines;
    const own = kindRate(steps, s);
    const note = ` · first forecast ~${s.original.lines}, ${times(factor)} since`;
    if (own === null) return dim(note);
    const beside = `${note}; its ${s.kind} steps missed by ${times(own)}`;
    return factor > own * OVERRUN ? amber(beside) : dim(beside);
  };
  for (const spec of [...new Set([...steps, ...unread].map((s) => s.spec))]) {
    const mine = steps.filter((s) => s.spec === spec);
    console.log(`\n  ${bold(pink(spec))}${dim(`  landed against the forecast it was built to; limit ${limit} lines`)}`);
    for (const s of mine.filter((x) => x.landed).sort((a, b) => a.t - b.t)) {
      const mark = s.measured > OVERRUN ? amber(times(s.ratio)) : times(s.ratio);
      const files = s.forecast.files === null ? `${s.files} file(s)` : `${s.files} file(s) of ${s.forecast.files}`;
      // Against a forecast revised while it was built too, so a project can tell a forecasting miss from correction rounds.
      const revised = s.revised ? `, revised to ~${s.revised.lines} while built: ${times(s.lines / s.revised.lines)} against it` : '';
      const first = s.first === null ? '' : `, first round ${s.first} ${times(s.measured)}`;
      const kind = s.kind ? `${s.kind} · ` : '';
      console.log(`    ${s.step.padEnd(10)} ~${String(s.forecast.lines).padEnd(5)} → ${String(s.lines).padEnd(5)} ${mark}  ${dim(`${kind}${files}${first}${revised} · ${s.hash.slice(0, 7)} ${s.at.slice(0, 10)}`)}`);
    }
    for (const s of mine.filter((x) => !x.landed)) {
      const rate = rateOf(steps, s);
      if (!rate) {
        console.log(`    ${s.step.padEnd(10)} ~${String(s.forecast.lines).padEnd(5)} ${dim('to land — forecast after every step that landed, so none measures it yet')}${carried(s)}`);
        continue;
      }
      const next = Math.round(s.forecast.lines * rate.rate);
      console.log(
        `    ${s.step.padEnd(10)} ~${String(s.forecast.lines).padEnd(5)} → ~${String(next).padEnd(5)} ` +
          dim(`to land, at ${times(rate.rate)} over ${rate.over} ${rate.kind ? `${rate.kind} ` : ''}step(s) forecast as it was`) +
          (next > limit ? amber(`  past ${limit}: split`) : '') +
          carried(s),
      );
    }
    for (const u of unread.filter((x) => x.spec === spec)) {
      const where = u.landed ? `before ${u.hash.slice(0, 7)}, the commit that landed it,` : 'to land,';
      console.log(`    ${u.step.padEnd(10)} ${amber('no forecast it can read')} ${dim(`— its \`Size:\` line ${where} says "${u.said}", so no rate counts it`)}`);
    }
  }
  console.log('');
  return 0;
}
