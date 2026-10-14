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
 * `1.6-spec-c` is not `1.6-spec-c2`.
 */
export function names(subject, spec, step) {
  const whole = '(?![\\w.-]*\\w)';
  return (
    new RegExp(`(^|[^\\w.-])${literal(spec)}${whole}`, 'i').test(subject) && new RegExp(`\\bstep[\\s-]+${literal(step)}${whole}`, 'i').test(subject)
  );
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
 * @returns {{steps: object[], limit: number}|null} Null outside a git repository.
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
  if (files.length === 0) return git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']) === null ? null : { steps: [], limit };
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
  for (const file of files) {
    const now = forecastIn(readFileSync(join(dir, file.path), 'utf8'));
    const landings = named.get(file.path).filter((c) => code.get(c.hash)?.size > 0);
    if (landings.length === 0) {
      if (!now) continue;
      // Forecast again in the working tree, it is newer than every commit.
      const since = at('HEAD', file.path)?.lines === now.lines ? writtenAt(file.path, Infinity, now.lines) : Infinity;
      steps.push({ ...file, landed: false, forecast: now, since });
      continue;
    }
    // The forecast the step was built to: its file before its first commit, or as that commit wrote it.
    const first = landings[0];
    const before = at(`${first.hash}^`, file.path);
    const forecast = before ?? at(first.hash, file.path);
    if (!forecast) continue;
    const since = (before ? writtenAt(file.path, order.get(first.hash), forecast.lines) : null) ?? first.t;
    const lines = new Map();
    for (const c of landings) for (const [path, added] of code.get(c.hash)) lines.set(path, (lines.get(path) ?? 0) + added);
    const total = [...lines.values()].reduce((a, n) => a + n, 0);
    const last = landings.at(-1);
    // A forecast changed while the step was built — a fix round's spec — is shown, and the step measured against the first.
    const revised = at(last.hash, file.path);
    steps.push({
      ...file,
      landed: true,
      forecast,
      revised: revised && revised.lines !== forecast.lines ? revised : null,
      since,
      lines: total,
      files: lines.size,
      ratio: total / forecast.lines,
      t: last.t,
      at: last.at,
      hash: last.hash,
    });
  }
  return { steps, limit };
}

/**
 * The rate to forecast a step again at: the median actual over forecast of its spec's newest landed steps forecast no
 * earlier than it was. A step forecast before the last re-forecast was measured against the old rates, which that
 * re-forecast already corrected for, and counting it would correct for them twice.
 *
 * @param {object[]} steps
 * @param {{spec: string, since?: string}} step - Its spec, and when its own forecast was written.
 * @returns {{rate: number, over: number}|null}
 */
export function rateOf(steps, { spec, since }) {
  // A forecast not known to be written when is measured by nothing, rather than by everything.
  if (since === null || since === undefined) return null;
  const landed = steps
    .filter((s) => s.landed && s.spec === spec && s.since >= since)
    .sort((a, b) => a.t - b.t)
    .slice(-RATE_OVER);
  return landed.length ? { rate: median(landed.map((s) => s.ratio)), over: landed.length } : null;
}

/**
 * What the detector says: the newest landed step, when it overran, and the steps of its spec still forecast as they
 * were when it landed.
 *
 * @param {string} dir
 * @param {{steps: object[], limit: number}} measured
 * @returns {{step: object, rate: {rate: number, over: number}, stale: object[]}|null}
 */
export function overrun({ steps }) {
  const newest = steps.filter((s) => s.landed).sort((a, b) => a.t - b.t).at(-1);
  if (!newest || newest.ratio <= OVERRUN) return null;
  // Forecast no later than the overrun step was, so its rate measures them: forecast again since, they are not stale.
  const stale = steps.filter((s) => !s.landed && s.spec === newest.spec && s.since !== null && s.since <= newest.since);
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
  const { steps, limit } = measured;
  if (check) {
    // During `nina upgrade --apply`: a step that overran is the project's history, not the move — and the release that
    // first shipped this detector rolled itself back in the project that asked for it. The move says it after.
    if (process.env.NINA_UPGRADE) {
      console.log('sizes: current');
      return 0;
    }
    const found = overrun(measured);
    if (!found) {
      console.log('sizes: current');
      return 0;
    }
    const { step, rate, stale } = found;
    const again = stale.slice(0, 4).map((s) => {
      const next = Math.round(s.forecast.lines * rate.rate);
      return `${s.step} ~${s.forecast.lines} → ~${next}${next > limit ? ` (past ${limit}: split)` : ''}`;
    });
    console.log(
      `step ${step.step} of ${step.spec} landed ${step.lines} lines against ~${step.forecast.lines} (${times(step.ratio)}); ` +
        `${stale.length} step(s) forecast when it was have not been forecast again — at ${times(rate.rate)}, over ${rate.over} landed step(s) forecast the same way: ` +
        `${again.join(', ')}${stale.length > again.length ? ', …' : ''}`,
    );
    return 1;
  }
  if (steps.length === 0) {
    console.log(`  no step file under ${SPECS} states a \`Size:\` line yet\n`);
    return 0;
  }
  for (const spec of [...new Set(steps.map((s) => s.spec))]) {
    const mine = steps.filter((s) => s.spec === spec);
    console.log(`\n  ${bold(pink(spec))}${dim(`  landed against the forecast it was built to; limit ${limit} lines`)}`);
    for (const s of mine.filter((x) => x.landed).sort((a, b) => a.t - b.t)) {
      const mark = s.ratio > OVERRUN ? amber(times(s.ratio)) : times(s.ratio);
      const files = s.forecast.files === null ? `${s.files} file(s)` : `${s.files} file(s) of ${s.forecast.files}`;
      const revised = s.revised ? `, revised to ~${s.revised.lines} while built` : '';
      console.log(`    ${s.step.padEnd(10)} ~${String(s.forecast.lines).padEnd(5)} → ${String(s.lines).padEnd(5)} ${mark}  ${dim(`${files}${revised} · ${s.hash.slice(0, 7)} ${s.at.slice(0, 10)}`)}`);
    }
    for (const s of mine.filter((x) => !x.landed)) {
      const rate = rateOf(steps, s);
      if (!rate) {
        console.log(`    ${s.step.padEnd(10)} ~${String(s.forecast.lines).padEnd(5)} ${dim('to land — forecast after every step that landed, so none measures it yet')}`);
        continue;
      }
      const next = Math.round(s.forecast.lines * rate.rate);
      console.log(
        `    ${s.step.padEnd(10)} ~${String(s.forecast.lines).padEnd(5)} → ~${String(next).padEnd(5)} ` +
          dim(`to land, at ${times(rate.rate)} over ${rate.over} step(s) forecast as it was`) +
          (next > limit ? amber(`  past ${limit}: split`) : ''),
      );
    }
  }
  console.log('');
  return 0;
}
