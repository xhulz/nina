/**
 * `nina learn` — whether a project's pipeline is learning from its own runs, link by link.
 *
 * A self-improving pipeline is a cycle, and the cycle is only as real as its weakest link:
 *
 *   observe   its runs are recorded                        — the snapshot
 *   capture   a mistake that will recur is written down    — a pill
 *   apply     the next run reads it                        — the role's spec tells it to
 *   graduate  a lesson that keeps recurring becomes a rule — a request to the harness
 *   verify    the rule is seen to have helped              — the loop-back rate, before and after
 *
 * An audit found every link but the first open. Capture ran at 3% of the rate the router asked
 * for (78 loop-backs, 2 pills). Apply was unmeasured — the transcripts were never read for it, and
 * once they were, 779 of 825 runs turned out to read their pills. Graduation had never fired, and
 * could not: no pill had ever had its `occurrences` bumped. And nothing anywhere compared a
 * role's loop-back rate before a lesson with after it, so the pipeline could not know whether a
 * lesson had helped even in principle.
 *
 * `--check` is the detector a project's `harness:check` runs every turn. It reports one thing: a
 * role that has looped back three times since its newest lesson. That is an event, not a ratio —
 * a rate that moves over weeks, reported every turn, is the noise the detectors exist to remove,
 * where "reviewer sent work back three times and nothing was written down" is something to act on.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { HARNESS, legacyHint, slugFor, snapshotsDir } from '../paths.mjs';
import { isLoopBack, runOf } from '../transcripts.mjs';
import { REQUIRES, byVersion, layerRootFor } from './compose.mjs';
import { GRADUATION_AT, frontmatter, graduationTarget, list, pillFiles, roleGates } from './pills.mjs';
import { decodeProjectDir } from './stats.mjs';
import { snapshot } from './snapshot.mjs';
import { loadProject, projectGateDir, readLedger, replay } from '../gate.mjs';
import { GATE, shippedScripts } from '../wiring.mjs';
import { deepLearn, transcriptsOf } from '../deep.mjs';
import { autoExport } from './export.mjs';
import { beforeModel } from '../detectors.mjs';

/** Loop-backs from one role, since its newest lesson, that make a lesson overdue. */
export const CAPTURE_AT = 3;

/**
 * How far back a loop-back still counts. Older ones are history nobody remembers well enough to
 * turn into a lesson; counting them would make the detector fire forever on a backlog.
 */
export const CAPTURE_DAYS = 14;

/** Readable verdicts needed on each side before a before/after comparison is shown at all. */
const VERIFY_MIN = 5;

export { slugFor };

/** The day part of a timestamp or a date. */
const day = (ts) => String(ts ?? '').slice(0, 10);

/** A verdict the parser actually read, as opposed to one it could not find. */
const readable = (v) => Boolean(v) && v !== 'UNCLEAR' && v !== 'NONE';

/**
 * The project's recorded dispatches.
 *
 * @param {string} target - The project directory.
 * @returns {Promise<object[]>}
 */
async function recorded(target) {
  const file = join(snapshotsDir(), `${slugFor(target)}.jsonl`);
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Every pill, with what the cycle needs from it.
 *
 * @param {string} target - The project directory.
 * @returns {Promise<{rel: string, path: string, roles: string[], date: string, last: string, occurrences: number, retired: boolean, body: string}[]>}
 */
export async function lessons(target) {
  const dir = join(target, '.claude', 'pills');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const pill of await pillFiles(dir)) {
    const text = await readFile(pill.path, 'utf8');
    const fields = frontmatter(text) ?? {};
    const date = /^\d{4}-\d{2}-\d{2}$/.test(fields.date ?? '') ? fields.date : '';
    // `last_seen` is set when a lesson is learned again and its counter bumped — without it, a
    // lesson re-learned yesterday would look as old as the day it was first written.
    const seen = /^\d{4}-\d{2}-\d{2}$/.test(fields.last_seen ?? '') ? fields.last_seen : '';
    // A date says which day, not when on it. The file's own modification time does, and it is
    // used only when it falls on that same day — a pill edited later says nothing about when the
    // lesson was learned.
    const last = seen > date ? seen : date;
    const mtime = (await stat(pill.path).catch(() => null))?.mtime?.toISOString() ?? null;
    out.push({
      at: mtime && day(mtime) === last ? mtime : null,
      rel: relative(target, pill.path),
      path: pill.path,
      roles: list(fields.applies_to),
      date,
      last,
      occurrences: Number(fields.occurrences ?? 1) || 1,
      retired: fields.status === 'retired',
      body: text.slice(text.indexOf('\n---', 3) + 4).trim(),
    });
  }
  return out;
}

/**
 * Roles that looped back often enough, since their newest lesson, that one is overdue.
 *
 * @param {object[]} records - Recorded dispatches.
 * @param {Awaited<ReturnType<typeof lessons>>} known - The project's pills.
 * @param {Date} now - Today.
 * @param {number} days - How far back a loop-back still counts.
 * @returns {{role: string, count: number, since: string|null, recent: {ts: string, desc: string, session: string}[]}[]}
 *   `recent` is the newest three, so whoever reads the warning can open the session and find the
 *   lesson: a count alone sends them digging through weeks of transcripts, which is how a warning
 *   becomes one more thing to ignore.
 */
export function overdue(records, known, now = new Date(), days = CAPTURE_DAYS) {
  const cutoff = day(new Date(now.getTime() - days * 86_400_000).toISOString());
  const roles = [...new Set(records.map((r) => r.role).filter(Boolean))];
  const out = [];
  for (const role of roles) {
    // A retired lesson was still written down: it retired because its rule moved into the harness,
    // not because the loop-backs before it went uncaptured. Leaving it out made every graduation
    // move the floor back, and the detector re-reported loop-backs a lesson had already answered.
    const taught = known
      .filter((l) => l.roles.includes(role) && l.last)
      .sort((a, b) => (a.last === b.last ? String(a.at ?? '').localeCompare(String(b.at ?? '')) : a.last.localeCompare(b.last)))
      .at(-1);
    const newest = taught?.last ?? null;
    const floor = newest && newest > cutoff ? newest : cutoff;
    // Strictly after the floor's day; on that same day, only after the moment the lesson was
    // written, when that moment is known. Comparing days alone let a lesson written this morning
    // absorb every loop-back until midnight — the lesson that is not working, which is the one
    // thing capture exists to catch.
    const at = floor === newest ? taught?.at ?? null : null;
    const after = (r) => day(r.ts) > floor || (at !== null && day(r.ts) === floor && String(r.ts) > at);
    const loops = records.filter((r) => r.role === role && readable(r.verdict) && isLoopBack(r.verdict) && after(r));
    if (loops.length >= CAPTURE_AT) {
      const recent = loops
        .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
        .slice(0, 3)
        .map((r) => ({ ts: day(r.ts), desc: r.desc ?? '', session: String(r.session ?? '').slice(0, 8) }));
      out.push({ role, count: loops.length, since: newest, recent });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Whether the roles that have lessons actually read them.
 *
 * @param {object[]} records - Recorded dispatches.
 * @param {Awaited<ReturnType<typeof lessons>>} known - The project's pills.
 * Opening is not applying — nothing here can see whether the rule was followed, only whether its
 * text was put in front of the agent. That is the most a transcript can say, and it is said as that.
 *
 * @returns {{measured: number, read: number, listed: number, from: string|null}}
 *   `listed` counts runs that listed the directory and read nothing from it.
 */
export function applied(records, known) {
  const taught = new Set(known.filter((l) => !l.retired).flatMap((l) => l.roles));
  // Only records captured after the field existed can answer; the rest are unknown, not "no". Asked of
  // runs, not rounds: a lesson a run read in its first round is in front of it in every round after.
  const runs = new Map();
  for (const r of records.filter((r) => taught.has(r.role) && 'lessons_read' in r)) runs.set(runOf(r), [...(runs.get(runOf(r)) ?? []), r]);
  const measured = [...runs.values()];
  const read = (rounds) => rounds.some((r) => r.lessons_read > 0);
  return {
    measured: measured.length,
    read: measured.filter(read).length,
    listed: measured.filter((rounds) => !read(rounds) && rounds.some((r) => r.lessons_listed)).length,
    from: measured.map((rounds) => day(rounds[0].ts)).sort()[0] ?? null,
  };
}

/**
 * The loop-back rate of a lesson's roles before it was written and after.
 *
 * Not proof — the work changes too, and a small sample swings — but without it the pipeline
 * cannot tell a lesson that helped from one that did not, even in principle.
 *
 * @param {object[]} records - Recorded dispatches.
 * @param {Awaited<ReturnType<typeof lessons>>} known - The project's pills.
 * Each comes with a control: every OTHER role, split at the same date. A lesson is written because
 * its role just started failing, so "after" is partly the same bad patch; and the whole pipeline's
 * rate moves with the work. The control does not remove either, but it shows whether the lesson's
 * roles moved differently from everything else, which the lesson's own numbers cannot.
 *
 * @returns {{rel: string, date: string, before: {n: number, loops: number}, after: {n: number, loops: number}, control: {before: {n: number, loops: number}, after: {n: number, loops: number}}}[]}
 */
export function verified(records, known) {
  const out = [];
  for (const lesson of known.filter((l) => l.date)) {
    const rate = (rs, pick) => {
      const s = rs.filter(pick);
      return { n: s.length, loops: s.filter((r) => isLoopBack(r.verdict)).length };
    };
    const mine = records.filter((r) => lesson.roles.includes(r.role) && readable(r.verdict));
    const others = records.filter((r) => r.role && !lesson.roles.includes(r.role) && readable(r.verdict));
    const pre = (r) => day(r.ts) < lesson.date;
    const post = (r) => day(r.ts) > lesson.date;
    const before = rate(mine, pre);
    const after = rate(mine, post);
    if (before.n >= VERIFY_MIN && after.n >= VERIFY_MIN) {
      out.push({ rel: lesson.rel, date: lesson.date, before, after, control: { before: rate(others, pre), after: rate(others, post) } });
    }
  }
  return out;
}

/**
 * Lessons that have recurred often enough to graduate and have no request yet. Before this, the
 * threshold was a note in a report someone had to go and read; the per-turn detector now files
 * the request itself.
 *
 * @param {Awaited<ReturnType<typeof lessons>>} known - The project's pills.
 * @param {{pill: string}[]} filed - Requests already written, open or closed.
 * @returns {Awaited<ReturnType<typeof lessons>>}
 */
export function unfiled(known, filed) {
  const asked = new Set(filed.map((r) => r.pill));
  return known.filter((l) => !l.retired && l.occurrences >= GRADUATION_AT && !asked.has(l.rel));
}

/**
 * Every request this project has written, with its status.
 *
 * @param {string} target - The project directory.
 * @returns {Promise<{file: string, status: string, pill: string, target: string, date: string}[]>}
 */
async function filedRequests(target) {
  const dir = join(target, HARNESS, 'requests');
  const out = [];
  for (const f of (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'))) {
    const fields = frontmatter(await readFile(join(dir, f), 'utf8')) ?? {};
    out.push({ file: f, id: f.replace(/\.md$/, ''), status: fields.status ?? '', pill: fields.pill ?? '', target: fields.target ?? '', date: fields.date ?? '' });
  }
  return out;
}

/** A value that has to fit on one frontmatter line. */
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * Marks a request answered and, when its rule shipped, retires the pill that carried it — the two
 * steps that used to be separate hand edits, either of which, forgotten, left a lesson both
 * graduated and still active, or a request open forever.
 *
 * @param {string} target - The project directory.
 * @param {string} file - The request's file name under `.nina/requests/`.
 * @param {{status: 'closed'|'declined', retire: boolean, fields?: Record<string, string>}} answer - How
 *   it was answered, whether the rule now reaches this project, and what to record in the request.
 * @returns {Promise<{pill: string|null}>} The pill it retired, if any.
 */
async function answerRequest(target, file, answer) {
  const path = join(target, HARNESS, 'requests', file);
  const text = await readFile(path, 'utf8');
  const fields = frontmatter(text) ?? {};
  const extra = Object.entries(answer.fields ?? {}).map(([k, v]) => `\n${k}: ${oneLine(v)}`).join('');
  await writeFile(path, text.replace(/^status: .*$/m, `status: ${answer.status}${extra}`));
  // A declined lesson is still this project's lesson: the harness said it does not belong in every
  // project, not that it stopped being true in this one. So is one whose rule went into a layer this
  // project does not compose — retiring it there would drop the lesson with nothing in its place.
  if (!answer.retire || !fields.pill || !existsSync(join(target, fields.pill))) return { pill: null };
  const pill = await readFile(join(target, fields.pill), 'utf8');
  const retired = /^status: .*$/m.test(pill) ? pill.replace(/^status: .*$/m, 'status: retired') : pill.replace(/^---\n/, '---\nstatus: retired\n');
  await writeFile(join(target, fields.pill), retired);
  return { pill: fields.pill };
}

/**
 * Closes one request by hand. `nina upgrade` closes the ones its release answers; this is for a
 * rule that reached the project some other way.
 *
 * @returns {Promise<number>} Process exit code.
 */
async function close(target, which) {
  const dir = join(target, HARNESS, 'requests');
  const file = (await readdir(dir).catch(() => [])).find((f) => f === which || join(dir, f) === resolve(target, which) || f.startsWith(which));
  if (!file) {
    console.error(`  no request matching ${which} under ${HARNESS}/requests/\n`);
    return 1;
  }
  const fields = frontmatter(await readFile(join(dir, file), 'utf8')) ?? {};
  const { pill } = await answerRequest(target, file, { status: 'closed', retire: true });
  console.log(`  closed ${HARNESS}/requests/${file}`);
  if (pill) console.log(`  retired ${pill} — the rule it carried now lives in ${fields.target || 'the harness'}`);
  console.log('');
  return 0;
}

/** Where the harness records its answer to each request. It is frozen into every release with the core. */
export const ANSWERED = join('core', 'answered.json');

/**
 * The harness's answers to project requests, as of one layer root: for each request id, either `in`
 * — the layer file the rule now lives in — or `declined` — why the lesson stays with its project.
 *
 * @param {string} layerRoot - A release directory, or the working tree.
 * @returns {Promise<Record<string, {in?: string, declined?: string}>>}
 */
export async function answers(layerRoot) {
  const text = await readFile(join(layerRoot, ANSWERED), 'utf8').catch(() => null);
  return text === null ? {} : JSON.parse(text);
}

/** A layer path as the project sees it: `core/tree/x` and `surfaces/db/tree/x` both compose to `x`. */
const composedPath = (layerPath) => layerPath.replace(/^(?:core|surfaces\/[^/]+)\/tree\//, '');

/**
 * The surface a project would have to declare for a layer file to reach it, or null when it does.
 * A surface file needs its surface; any file needs whatever its core counterpart is gated on.
 *
 * @param {string} layerRoot - The release.
 * @param {string} layerPath - `core/tree/...` or `surfaces/<s>/tree/...`.
 * @param {string[]} surfaces - What the project declares.
 * @returns {Promise<string|null>}
 */
async function missingSurface(layerRoot, layerPath, surfaces) {
  const own = /^surfaces\/([^/]+)\/tree\//.exec(layerPath)?.[1];
  if (own && !surfaces.includes(own)) return own;
  const core = await readFile(join(layerRoot, 'core', 'tree', composedPath(layerPath)), 'utf8').catch(() => '');
  const gate = REQUIRES.exec(core)?.[1] ?? null;
  return gate && !surfaces.includes(gate) ? gate : null;
}

/**
 * Closes every open request the release being moved to answers.
 *
 * This is the project's end of graduation, and it used to be a command someone had to remember
 * after an upgrade, once per request, by file name. The release now says which requests it
 * answers, so the upgrade that installs it closes them — and the answer only becomes true for a
 * project at that moment, which is why it is not written into the project any earlier.
 *
 * @param {string} target - The project directory.
 * @param {string} layerRoot - The release being moved to.
 * @param {string} version - Its version, recorded in each request it answers.
 * @returns {Promise<{file: string, status: 'closed'|'declined', pill: string|null, where?: string, needs?: string|null, why?: string}[]>}
 *   `needs` is set when the rule went into a layer this project does not compose: the request is
 *   answered all the same, and the pill stays active, because the rule never arrives here.
 */
export async function closeAnswered(target, layerRoot, version) {
  const given = await answers(layerRoot);
  const profile = JSON.parse(await readFile(join(target, HARNESS, 'profile.json'), 'utf8').catch(() => '{}'));
  const out = [];
  for (const r of (await filedRequests(target)).filter((r) => r.status === 'open' && given[r.id])) {
    const a = given[r.id];
    if (a.in) {
      const where = composedPath(a.in);
      const needs = await missingSurface(layerRoot, a.in, profile.surfaces ?? []);
      const fields = { answered_in: version, rule_in: needs ? `${a.in} (needs the ${needs} surface)` : where };
      const { pill } = await answerRequest(target, r.file, { status: 'closed', retire: !needs, fields });
      out.push({ file: r.file, status: 'closed', pill, where, needs });
    } else if (a.declined) {
      await answerRequest(target, r.file, { status: 'declined', retire: false, fields: { answered_in: version, declined: a.declined } });
      out.push({ file: r.file, status: 'declined', pill: null, why: oneLine(a.declined) });
    }
  }
  return out;
}

/**
 * What the loop gate recorded for a project in the window: the rounds dispatches made on capped edges,
 * and how many it sent to the owner at the cap. Null when the project has no ledger at all.
 *
 * @param {string} target - The project directory.
 * @param {string} since - ISO timestamp; older facts are history.
 */
function gateActivity(target, since) {
  const dir = projectGateDir(target);
  if (!existsSync(dir)) return null;
  const project = loadProject(target);
  const out = { sessions: 0, rounds: 0, longest: 0, held: 0 };
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f !== 'errors.jsonl')) {
    const entries = readLedger(join(dir, file));
    const recent = entries.filter((e) => String(e.at ?? '') >= since);
    if (recent.length === 0) continue;
    out.sessions += 1;
    const made = replay(entries, project?.loops ?? new Map(), project?.forward).rounds.filter((r) => String(r.at ?? '') >= since);
    out.rounds += made.length;
    // The longest loop is the edge's count: a round counted by issue numbers that issue, not the loop.
    out.longest = Math.max(out.longest, ...made.map((r) => r.edgeRound ?? r.round));
    out.held += recent.filter((e) => e.k === 'ask').length;
  }
  return out;
}

/** Formats a share as a whole percentage. */
const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

/**
 * `--deep`: the loop-backs read by a model, grouped by cause, set against the pills already written.
 *
 * @returns {Promise<number>}
 */
async function deepReport(target, records, known, argv) {
  const days = argv.includes('--days') ? Number(argv[argv.indexOf('--days') + 1]) || 30 : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const dry = argv.includes('--dry-run');
  const result = await deepLearn({
    records,
    known,
    projectDir: transcriptsOf(slugFor(target)),
    since,
    model: argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : undefined,
    api: argv.includes('--api'),
    dry,
    progress: (step) => process.stderr.write(`  ${step}…\n`),
  });
  console.log(
    `  deep: ${result.reports} loop-back report(s) since ${since.slice(0, 10)}` +
      (result.gone ? `, and ${result.gone} more with no transcript or report left to read` : '') +
      (dry ? ` — would take ${result.calls} call(s) on the login` : result.reports ? ` · ${result.made} of ${result.calls} call(s) made, $${result.cost.toFixed(2)} API-equivalent` : ''),
  );
  if (result.uncaused) console.log(`  ${result.uncaused} report(s) the model gave no cause for, so the grouping below never saw them`);
  if (result.failed) {
    console.log(`  ✗ ${result.failed}`);
    return 1;
  }
  for (const c of result.clusters ?? []) {
    const roles = [...new Set(c.refs.map((ref) => ref.replace(/-[^-]+$/, '')))].join(', ');
    console.log(`    ${String(c.refs.length).padStart(2)}×  ${roles} · ${c.cause}`);
    if (c.covered_by) console.log(`         covered by ${c.covered_by}`);
    else if (c.proposal) console.log(`         no pill yet — for ${c.proposal.role}: "${c.proposal.title}" — when ${c.proposal.trigger} — ${c.proposal.lesson}`);
    else console.log(`         no pill, and none proposed${c.invented ? ` — the model named ${c.invented}, which does not exist` : ' — a one-off, or too broad for one lesson'}`);
  }
  if (result.clusters?.some((c) => !c.covered_by && c.proposal)) {
    console.log('\n  Proposals only: a lesson is filed as a pill by the orchestrator or the owner — .claude/pills/README.md says how.');
  }
  return 0;
}

/**
 * Writes a graduation request: a lesson this project keeps relearning, addressed to the harness.
 *
 * A project cannot change the harness — the core and the surfaces live in another repository, and
 * a project composes a frozen version of them. So graduating a lesson is a request, not an edit,
 * and it carries what the maintainer needs to act on it: the pinned version it was learned
 * against, the layer it belongs in, and the lesson in the project's own words. The pill stays
 * active until the release carrying the rule is installed; retiring it earlier would drop the
 * lesson in the gap.
 *
 * @param {string} target - The project directory.
 * @param {{core: string}} profile - The project's profile.
 * @param {string} layerRoot - The pinned release, which says which layer each role lives in.
 * @param {Awaited<ReturnType<typeof lessons>>[number]} lesson - A lesson that names its roles.
 * @returns {Promise<{file: string, layer: string, why: string}>}
 */
async function fileRequest(target, profile, layerRoot, lesson) {
  const target_ = graduationTarget(lesson.roles, await roleGates(layerRoot));
  const date = new Date().toISOString().slice(0, 10);
  // The directory separator becomes `__`, so `reviewer/a.b.md` and `reviewer-a/b.md` stay two
  // names — flattening both `/` and `.` to `-` gave them the same one.
  const name = lesson.rel.replace(/^\.claude\/pills\//, '').replace(/\.md$/, '').replace(/\//g, '__');
  const dir = join(target, HARNESS, 'requests');
  const file = `${date}-${name}.md`;
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, file),
    [
      '---',
      'kind: harness-request',
      'status: open',
      `date: ${date}`,
      `core: ${profile.core}`,
      `target: ${target_.layer}`,
      `pill: ${lesson.rel}`,
      `occurrences: ${lesson.occurrences}`,
      '---',
      '',
      `**A lesson this project has learned ${lesson.occurrences} time(s), proposed as a rule in \`${target_.layer}\`** — ${target_.why}.`,
      '',
      `Learned against core ${profile.core}. The rule lands in a release of the harness, and the`,
      '`nina upgrade` that installs that release closes this request and retires the pill — not before.',
      '',
      lesson.body,
      '',
    ].join('\n'),
  );
  return { file, layer: target_.layer, why: target_.why };
}

/**
 * `nina learn --graduate <pill>` — files a request by hand. The detector files one on its own
 * once a lesson reaches three occurrences; this is for sending one sooner.
 *
 * @returns {Promise<number>} Process exit code.
 */
async function graduate(target, profile, layerRoot, known, which) {
  const lesson = known.find((l) => l.rel === which || l.path === resolve(target, which));
  if (!lesson) {
    console.error(`  no pill at ${which} — run \`nina learn\` to list them\n`);
    return 1;
  }
  if (lesson.roles.length === 0) {
    console.error(`  ${lesson.rel} names no role in applies_to, so there is no layer to send it to — \`nina pills\` says what to fix\n`);
    return 1;
  }
  // One request per lesson. A second graduation — a retry, a router firing twice — used to
  // overwrite the first, and could reopen one the maintainer had already closed.
  const earlier = (await filedRequests(target)).find((r) => r.pill === lesson.rel);
  if (earlier) {
    console.error(`  ${lesson.rel} was already requested on ${earlier.date} (${earlier.status}): ${HARNESS}/requests/${earlier.file}\n`);
    return 1;
  }
  const filed = await fileRequest(target, profile, layerRoot, lesson);
  console.log(`  request written: ${HARNESS}/requests/${filed.file}`);
  console.log(`  target: ${filed.layer} — ${filed.why}`);
  console.log('  the harness maintainer sees it with `nina requests`\n');
  return 0;
}

/**
 * Runs the learning report, the detector, or a graduation.
 *
 * @param {string[]} argv - `[--project <dir>] [--check] [--graduate <pill>] [--days N]`.
 * @param {{root: string}} ctx - CLI context.
 * @returns {Promise<number>} Process exit code.
 */
export async function learn(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  const check = argv.includes('--check');
  const days = argv.includes('--days') ? Number(argv[argv.indexOf('--days') + 1]) || CAPTURE_DAYS : CAPTURE_DAYS;

  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    console.error(`  no ${HARNESS}/profile.json under ${target}${legacyHint(target)}\n`);
    return check ? 2 : 1;
  }
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));
  const resolved = layerRootFor(ctx.root, profile.core);
  if (resolved.error) {
    console.error(`  ${resolved.error}\n`);
    return check ? 2 : 1;
  }

  // Observe this project before reading it. The snapshot used to depend on one global hook that
  // pointed at a checkout of the harness and swallowed its own failures — on a machine without
  // that checkout, nothing was recorded and nothing said so. A failure here is not a lesson
  // failure, so it is swallowed too, but the project now observes itself.
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    await snapshot(['--project', slugFor(target), '--exact', '--quiet'], ctx);
  } catch {
    // Reported below as an empty record, which is what it is.
  } finally {
    console.log = log;
    console.error = err;
  }

  const records = await recorded(target);
  const known = await lessons(target);

  if (argv.includes('--deep')) return deepReport(target, records, known, argv);

  if (argv.includes('--graduate')) {
    return graduate(target, profile, resolved.dir, known, argv[argv.indexOf('--graduate') + 1] ?? '');
  }
  if (argv.includes('--close')) return close(target, argv[argv.indexOf('--close') + 1] ?? '');

  const late = overdue(records, known, new Date(), days);
  const filed = await filedRequests(target);
  const owed = unfiled(known, filed);

  if (check) {
    // During `nina upgrade --apply`: this is about history, not the move — see upgrade.mjs.
    if (process.env.NINA_UPGRADE) {
      console.log('learn: current');
      return 0;
    }
    // A project sending its runs to Langfuse sends them from here, where it was just snapshotted — in the
    // background, and said here only when the last attempt failed. Like a request that cannot be written,
    // an export that cannot even start is a finding, not a detector that throws.
    let exported = null;
    try {
      exported = await autoExport(slugFor(target), records);
    } catch (error) {
      exported = `the export to Langfuse could not start — ${error.message}`;
    }
    // A lesson at three occurrences used to be reported here with the command that files it, and
    // then it waited for someone to type that command. Filing decides nothing — the request is a
    // proposal the harness maintainer accepts or declines — so the detector files it and says so
    // once. The per-line actions matter too: one hint for the whole detector told a project to
    // "write the lesson" when the lesson was written three times over and only needed sending.
    const sent = [];
    const stuck = owed
      .filter((l) => l.roles.length === 0)
      .map((lesson) => ({ lesson, why: 'names no role in applies_to, so no layer can take it', fix: 'fix its frontmatter — `nina pills` says what is wrong' }));
    // Sent from the Stop hook, a request was news only the person heard: its one line said the model would
    // be told, and by the next message the lesson was no longer owed, so nothing told it. It is sent by the
    // run that hands its findings to the model, or by hand; the Stop hook says it is about to go.
    const due = beforeModel() ? owed.filter((l) => l.roles.length > 0) : [];
    for (const lesson of beforeModel() ? [] : owed.filter((l) => l.roles.length > 0)) {
      // A detector that throws is reported as one that could not run, every turn, and takes the
      // rest of its findings with it — so a request that cannot be written is a finding instead.
      try {
        sent.push({ lesson, ...(await fileRequest(target, profile, resolved.dir, lesson)) });
      } catch (error) {
        stuck.push({ lesson, why: `could not be written to ${HARNESS}/requests/ — ${error.message}`, fix: `make it writable, or send it by hand: \`nina learn --graduate ${lesson.rel}\`` });
      }
    }
    if (late.length === 0 && sent.length === 0 && due.length === 0 && stuck.length === 0 && !exported) {
      console.log('learn: current');
      return 0;
    }
    for (const o of late) {
      console.log(
        `  ${o.role}: ${o.count} loop-back(s) in the last ${days} days ` +
          (o.since ? `since its newest lesson (${o.since})` : 'and no lesson at all') +
          ' — the newest:',
      );
      for (const r of o.recent) console.log(`      ${r.ts}  ${r.desc || '(no description)'}  session ${r.session}`);
      console.log('    → ask of each whether it would happen again; if so, write the pill, or bump `occurrences` and `last_seen` on the one that already says it');
    }
    for (const s of sent) {
      console.log(`  ${s.lesson.rel} has recurred ${s.lesson.occurrences} times — sent to the harness as ${HARNESS}/requests/${s.file}, proposing a rule in ${s.layer}`);
      console.log('    → commit it with the pill; nothing else is owed here. `nina upgrade` to the release that answers it closes it and retires the pill');
    }
    for (const lesson of due) {
      console.log(`  ${lesson.rel} has recurred ${lesson.occurrences} times — it goes to the harness as a request before your next message`);
    }
    for (const s of stuck) {
      console.log(`  ${s.lesson.rel} has recurred ${s.lesson.occurrences} times and ${s.why}`);
      console.log(`    → ${s.fix}`);
    }
    if (exported) console.log(`  ${exported}`);
    console.log(
      `learn: ${[
        late.length && `${late.length} role(s) keep being sent back with nothing written down`,
        sent.length && `${sent.length} lesson(s) sent to the harness`,
        due.length && `${due.length} lesson(s) to send to the harness`,
        stuck.length && `${stuck.length} lesson(s) cannot be sent`,
        exported && 'the Langfuse export needs a look',
      ]
        .filter(Boolean)
        .join('; ')}`,
    );
    return 1;
  }

  const active = known.filter((l) => !l.retired);
  const ready = active.filter((l) => l.occurrences >= GRADUATION_AT);
  const open = filed.filter((r) => r.status === 'open');
  const use = applied(records, known);
  const checks = verified(records, known);
  const span = records.length ? `${day(records[0].ts)} → ${day(records.at(-1).ts)}` : '';

  console.log(`\n  learning — core ${profile.core}\n`);
  console.log(
    records.length
      ? `  observe   ${new Set(records.map(runOf)).size} run(s) in ${records.length} round(s) recorded, ${span}`
      : '  observe   ✗ nothing recorded — no transcripts found for this project, so no link below can be measured',
  );
  if (late.length === 0) console.log(`  capture   ✓ no role has looped back ${CAPTURE_AT}+ times without a lesson in the last ${days} days`);
  late.forEach((o, i) => {
    console.log(
      `  ${i === 0 ? 'capture ' : '        '}  ✗ ${o.role}: ${o.count} loop-back(s) ` +
        (o.since ? `since its newest lesson (${o.since})` : 'and no lesson at all'),
    );
  });
  console.log(
    use.measured
      ? `  apply     ${use.read} of ${use.measured} run(s) of roles that have lessons read one (${pct(use.read, use.measured)}); ` +
          `${use.listed} only listed the directory — measured since ${use.from}. Reading is not obeying; nothing here can see that.`
      : '  apply     not measured yet — runs recorded from now on say whether they read their pills',
  );
  console.log(
    `  graduate  ${ready.length} lesson(s) at ${GRADUATION_AT}+ occurrences · ${open.length} request(s) open` +
      (Math.max(0, ...active.map((l) => l.occurrences)) < 2
        ? ' — no lesson has ever been counted twice; bump `occurrences` when one recurs'
        : ''),
  );
  for (const l of ready.filter((l) => owed.includes(l))) console.log(`            not sent yet: ${l.rel} — the next \`harness:check\` sends it`);
  for (const r of open) console.log(`            open since ${r.date}: ${r.pill} → ${r.target}. \`nina upgrade\` to the release that answers it closes it`);
  if (checks.length === 0) console.log(`  verify    no lesson has ${VERIFY_MIN}+ readable verdicts on both sides of its date yet`);
  checks.forEach((c, i) => {
    console.log(
      `  ${i === 0 ? 'verify  ' : '        '}  ${c.rel.replace(/^\.claude\/pills\//, '')} (${c.date}): ` +
        `${pct(c.before.loops, c.before.n)} → ${pct(c.after.loops, c.after.n)} loop-back (n ${c.before.n} → ${c.after.n}); ` +
        `every other role ${pct(c.control.before.loops, c.control.before.n)} → ${pct(c.control.after.loops, c.control.after.n)}`,
    );
  });
  // The loops the lessons are about, as the gate counted them — beside the lessons, because a loop the
  // gate held is a lesson waiting to be asked for.
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const activity = gateActivity(target, since);
  if (!(await shippedScripts(resolved.dir, profile.surfaces ?? [])).has(GATE)) {
    console.log(`  loops     core ${profile.core} has no loop gate — the caps in .claude/graph.md are instructions`);
  } else if (!activity) {
    console.log('  loops     the gate has no ledger for this project — `nina gate --selftest` says whether it is wired');
  } else {
    console.log(
      `  loops     ${activity.rounds} round(s) on capped edges in ${activity.sessions} session(s) in the last ${days} days` +
        (activity.rounds ? `, the longest ${activity.longest}` : '') +
        ` · ${activity.held} sent to you at the cap`,
    );
  }
  console.log(
    late.length
      ? `\nlearn: ${late.length} role(s) keep being sent back with nothing written down\n`
      : '\nlearn: the cycle has no open event\n',
  );
  return 0;
}

/**
 * The first release that carries each answer, by request id.
 *
 * @param {string} root - The NINA install directory.
 * @returns {Promise<Map<string, string>>}
 */
async function releasedAnswers(root) {
  const shipped = new Map();
  const versions = (await readdir(join(root, 'releases')).catch(() => [])).sort(byVersion);
  for (const v of versions) {
    for (const id of Object.keys(await answers(join(root, 'releases', v)))) if (!shipped.has(id)) shipped.set(id, v);
  }
  return shipped;
}

/**
 * Records the harness's answer to one request in the working core, which the next release freezes.
 *
 * @param {string[]} argv - `--answer <request> --in <layer file>` or `--decline <request> --why <reason>`.
 * @param {{root: string}} ctx - CLI context.
 * @param {{id: string, dir: string}[]} open - Every open request on this machine.
 * @returns {Promise<number>} Process exit code.
 */
async function recordAnswer(argv, ctx, open) {
  const declining = argv.includes('--decline');
  const which = argv[argv.indexOf(declining ? '--decline' : '--answer') + 1] ?? '';
  const exact = open.filter((r) => r.id === which);
  const matches = exact.length > 0 ? exact : open.filter((r) => which && r.id.includes(which));
  // An id is a date and a pill path, so two projects can file the same one. The answer is keyed by
  // id and reaches both, which is only right because it is said out loud below.
  const ids = [...new Set(matches.map((r) => r.id))];
  if (ids.length !== 1) {
    console.error(
      ids.length === 0
        ? `  no open request matches "${which}" — \`nina requests\` lists them\n`
        : `  "${which}" matches ${ids.length} requests — name one:\n${ids.map((id) => `    ${id}`).join('\n')}\n`,
    );
    return 1;
  }
  if (!existsSync(join(ctx.root, 'core'))) {
    console.error(`  ${ctx.root} has no working core — answers are recorded in a checkout of the NINA repo\n`);
    return 1;
  }
  const { id } = matches[0];
  let answer;
  if (declining) {
    const why = argv.includes('--why') ? argv[argv.indexOf('--why') + 1] ?? '' : '';
    if (!why.trim()) {
      console.error('  a decline says why: --why "<reason>" — the project reads it when the request closes\n');
      return 1;
    }
    answer = { declined: why.trim() };
  } else {
    const where = argv.includes('--in') ? argv[argv.indexOf('--in') + 1] ?? '' : '';
    // A path the release can resolve, or the project is told its rule lives somewhere it does not.
    if (!/^(?:core|surfaces\/[^/]+)\/tree\/./.test(where) || !existsSync(join(ctx.root, where))) {
      console.error(`  --in names the layer file that now carries the rule, e.g. core/tree/.claude/agents/qa.md — got "${where}"\n`);
      return 1;
    }
    answer = { in: where };
  }
  const all = await answers(ctx.root);
  all[id] = answer;
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  await writeFile(join(ctx.root, ANSWERED), `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`  ${declining ? 'declined' : 'answered'} ${id}${answer.in ? ` — the rule is in ${answer.in}` : ''}`);
  if (matches.length > 1) console.log(`  ${matches.length} projects filed this same id — the answer reaches every one of them:\n${matches.map((r) => `    ${r.dir}`).join('\n')}`);
  console.log('  recorded in core/answered.json. The next release carries it, and the project closes the request');
  console.log('  when it upgrades to that release.\n');
  return 0;
}

/**
 * The harness maintainer's inbox: every open graduation request, from every project measured on
 * this machine. This is where a project's lesson reaches the repository that can turn it into a
 * rule for every project.
 *
 * It is also where a request is answered. `--answer <request> --in <layer file>` records that the
 * rule now lives in a layer; `--decline <request> --why <reason>` that the lesson stays with its
 * project. Either goes into `core/answered.json`, which the next release freezes, and `nina upgrade`
 * to that release closes the request in the project that filed it. The answer is not written into
 * the project from here: this repository does not edit the projects it serves, and the answer only
 * becomes true for a project when it installs the release that carries it.
 *
 * @param {string[]} argv - `[--check] [--answer <request> --in <file> | --decline <request> --why <reason>]`.
 * @param {{root: string}} ctx - CLI context.
 * @returns {Promise<number>} Process exit code.
 */
export async function requests(argv = [], ctx = { root: '.' }) {
  const check = argv.includes('--check');
  const found = [];
  const files = (await readdir(snapshotsDir()).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
  for (const file of files) {
    const dir = decodeProjectDir(file.replace(/\.jsonl$/, ''));
    if (!dir) continue;
    const reqDir = join(dir, HARNESS, 'requests');
    for (const f of (await readdir(reqDir).catch(() => [])).filter((f) => f.endsWith('.md'))) {
      const fields = frontmatter(await readFile(join(reqDir, f), 'utf8'));
      if (fields?.status === 'open') found.push({ dir, f, id: f.replace(/\.md$/, ''), fields });
    }
  }
  if (argv.includes('--answer') || argv.includes('--decline')) return recordAnswer(argv, ctx, found);

  const working = await answers(ctx.root);
  const shipped = await releasedAnswers(ctx.root);
  // What this repository still owes: an answer, or a release to carry one. A request answered in a
  // release waits on its project's upgrade, and reporting it here every turn would be noise about
  // work that is not this repository's.
  const unanswered = found.filter((r) => !working[r.id] && !shipped.has(r.id));
  const unreleased = found.filter((r) => working[r.id] && !shipped.has(r.id));
  const where = (r) => join(r.dir, HARNESS, 'requests', r.f);

  if (check) {
    if (unanswered.length === 0 && unreleased.length === 0) {
      console.log('requests: nothing waiting on the harness');
      return 0;
    }
    // The maintainer's side of graduation used to be "run nina requests and remember to" — the one
    // step with nothing to prompt it. This repo's own harness:check runs this every turn.
    for (const r of unanswered) console.log(`  ${r.fields.date}  ${r.fields.pill} → ${r.fields.target} (core ${r.fields.core})  ${where(r)}`);
    for (const r of unreleased) console.log(`  answered, not released: ${r.id}`);
    console.log(
      `requests: ${[
        unanswered.length && `${unanswered.length} lesson(s) from projects are waiting to become rules`,
        unreleased.length && `${unreleased.length} answer(s) are waiting for a release`,
      ]
        .filter(Boolean)
        .join('; ')}`,
    );
    return 1;
  }
  if (found.length === 0) {
    console.log('  no open requests — no project has graduated a lesson to the harness\n');
    return 0;
  }
  console.log(`\n  ${found.length} open request(s)\n`);
  for (const r of found) {
    const state = shipped.has(r.id)
      ? `answered in ${shipped.get(r.id)} — closes when the project upgrades to it`
      : working[r.id]
        ? 'answered in the working core — cut a release to carry it'
        : `waiting — nina requests --answer ${r.id} --in <layer file>, or --decline … --why …`;
    console.log(`  ${r.fields.date}  ${r.fields.target.padEnd(20)} core ${r.fields.core}  ${r.fields.pill}`);
    console.log(`              ${where(r)}`);
    console.log(`              ${state}`);
  }
  console.log('');
  return 0;
}
