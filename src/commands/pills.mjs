/**
 * `nina pills` — validates a project's pills against the format the core defines.
 *
 * A pill is the only part of the harness the pipeline writes about itself, and until now it
 * was the only part nothing read back. The cost of that is not untidiness: a pill filed where
 * its audience never globs is never delivered, a pill without frontmatter cannot be filtered
 * by `status` or `trigger`, and a pill with no evidence is the unfounded claim this harness
 * exists to remove. All three look fine to a human skimming the directory.
 *
 * This reads the project, never the layers — pills are written at runtime, not composed.
 */

import { readFile, readdir } from 'node:fs/promises';
import { HARNESS } from '../paths.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { REQUIRES, layerRootFor } from './compose.mjs';

/** Fields every pill must carry, and what breaks without each one. */
const REQUIRED = {
  id: 'nothing can refer to this pill',
  applies_to: 'nobody knows who must read it',
  severity: 'it cannot be weighed against another pill',
  status: 'a graduated pill keeps being applied',
  date: 'staleness cannot be spotted',
  trigger: 'the agent applies it to every task instead of the matching one',
};

/** The severities a pill may declare. */
const SEVERITIES = ['low', 'medium', 'high'];

/** The statuses a pill may declare. */
const STATUSES = ['active', 'retired'];

/**
 * How often the same lesson must be learned before it stops being an anecdote.
 *
 * The format's own wording: a pill learned once is a note, and the same pill learned a third
 * time is evidence that the surrounding rules do not cover the case.
 */
export const GRADUATION_AT = 3;

/** A citation is a repository path, optionally with a line. */
const CITATION = /^[^\s:]+(:\d+)?$/;

/**
 * Splits a pill's YAML frontmatter from its body.
 *
 * Deliberately small: the format is a flat map of scalars and one-line lists, and a real
 * YAML parser would accept far more than the format allows.
 *
 * @param {string} text - The whole file.
 * @returns {Record<string, string> | null} The fields, or `null` when there is no frontmatter.
 */
export function frontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fields = {};
  for (const line of text.slice(4, end + 1).split('\n')) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

/**
 * Reads a bracketed one-line list.
 *
 * @param {string} [value] - The raw field value.
 * @returns {string[]} The entries, empty when the field is absent or empty.
 */
export function list(value) {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}


/**
 * Resolves one citation against the project.
 *
 * Three outcomes that look identical in a directory listing and are not: the file is gone,
 * the file is there but shorter than the cited line, or both still resolve. Only the first
 * two are decidable from the filesystem — whether the line still *says* what the pill claims
 * is not, which is what `lastChanged` is for.
 *
 * @param {string} target - The project root the citation is relative to.
 * @param {string} citation - `path` or `path:line`.
 * @returns {{state: 'ok'|'gone'|'truncated', path: string, line: number|null, lines?: number}}
 */
export function resolveCitation(target, citation) {
  const at = /^(.*):(\d+)$/.exec(citation);
  const path = at ? at[1] : citation;
  const line = at ? Number(at[2]) : null;
  const full = join(target, path);
  if (!existsSync(full) || !statSync(full).isFile()) return { state: 'gone', path, line };
  if (line === null) return { state: 'ok', path, line };
  const text = readFileSync(full, 'utf8');
  const lines = text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length;
  return line > lines ? { state: 'truncated', path, line, lines } : { state: 'ok', path, line };
}

/**
 * When a file last changed, as far as git knows.
 *
 * A citation that still resolves can still be wrong — the line survived but the code on it
 * moved on. Nothing can settle that mechanically, so this reports the one fact that makes it
 * worth a person's attention: the file changed after the pill was written.
 *
 * @param {string} target - The repository.
 * @param {string} path - A path inside it.
 * Only committed history counts, so an uncommitted edit to a cited file does not register.
 * That is the right boundary: a pill is checked against what the repository says, not against
 * one working tree.
 *
 * @param {string} target - The repository.
 * @param {string} path - A path inside it.
 * @returns {string | null} `YYYY-MM-DD`, or `null` when git cannot say.
 */
export function lastChanged(target, path) {
  const git = spawnSync('git', ['-C', target, 'log', '-1', '--format=%cs', '--', path], { encoding: 'utf8' });
  if (git.status !== 0) return null;
  const when = git.stdout.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : null;
}


/**
 * Which surface each role's spec is gated on, from the layers the project composes.
 *
 * The gate is stripped during composition, so the composed spec cannot answer this — only
 * the layer it came from can. A role with no gate is composed by every project, which is
 * what makes the core the right home for a lesson about it.
 *
 * @param {string} layerRoot - Where the core is read from.
 * @returns {Promise<Map<string, string|null>>} Role to the surface it requires, or `null`.
 */
export async function roleGates(layerRoot) {
  const dir = join(layerRoot, 'core', 'tree', '.claude', 'agents');
  const gates = new Map();
  for (const file of await readdir(dir).catch(() => [])) {
    if (!file.endsWith('.md')) continue;
    const requires = REQUIRES.exec(await readFile(join(dir, file), 'utf8'));
    gates.set(file.replace(/\.md$/, ''), requires ? requires[1] : null);
  }
  return gates;
}

/**
 * Where a recurring pill's lesson belongs once it stops being a pill.
 *
 * A lesson about a role every project composes belongs in the core. A lesson about a role
 * that exists only because of a surface belongs in that surface. This is a proposal, not a
 * verdict: a reviewer pill can still be about one surface, and only a person can tell.
 *
 * @param {string[]} applies - The roles the pill declares.
 * @param {Map<string, string|null>} gates - From `roleGates`.
 * @returns {{layer: string, why: string}}
 */
export function graduationTarget(applies, gates) {
  const surfaces = applies.map((role) => gates.get(role) ?? null);
  const [first] = surfaces;
  if (first && surfaces.every((s) => s === first)) {
    const verb = applies.length > 1 ? 'exist' : 'exists';
    return { layer: `surfaces/${first}`, why: `${applies.join(' and ')} ${verb} only where there is a ${first} surface` };
  }
  return { layer: 'core', why: `every project composes ${applies.length > 1 ? 'these roles' : applies[0]}` };
}

/**
 * Every pill file in a project, as `{dir, file, path}`.
 *
 * `dir` is `''` for a file loose at the top level, which is the case worth reporting: no
 * agent globs there, so the pill is read by nobody.
 *
 * @param {string} pillsDir - The project's `.claude/pills`.
 * @returns {Promise<{dir: string, file: string, path: string}[]>}
 */
export async function pillFiles(pillsDir) {
  const found = [];
  for (const entry of await readdir(pillsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const file of await readdir(join(pillsDir, entry.name))) {
        if (file.endsWith('.md')) found.push({ dir: entry.name, file, path: join(pillsDir, entry.name, file) });
      }
    } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
      found.push({ dir: '', file: entry.name, path: join(pillsDir, entry.name) });
    }
  }
  return found.sort((a, b) => `${a.dir}/${a.file}`.localeCompare(`${b.dir}/${b.file}`));
}

/**
 * Validates one pill.
 *
 * @param {{dir: string, file: string}} pill - Where the pill sits.
 * @param {string} text - Its contents.
 * @param {string[]} roles - The roles this project actually composes.
 * @param {string} today - Today as `YYYY-MM-DD`, so the check is testable.
 * @returns {{problems: string[], notes: string[], fields: Record<string, string> | null}}
 */
export function validate(pill, text, roles, today) {
  const label = `${pill.dir ? `${pill.dir}/` : ''}${pill.file}`;
  const problems = [];
  const notes = [];

  if (pill.dir === '') {
    problems.push(`${label} sits at the top level of pills/ — no agent globs there, so nobody reads it`);
  }

  const fields = frontmatter(text);
  if (fields === null) {
    problems.push(`${label} has no frontmatter — it cannot be filtered by status, trigger or role`);
    return { problems, notes, fields: null, label, citations: [], uncited: true };
  }

  for (const [field, why] of Object.entries(REQUIRED)) {
    if (!fields[field]) problems.push(`${label} has no "${field}" — ${why}`);
  }

  const applies = list(fields.applies_to);
  for (const role of applies) {
    if (!roles.includes(role)) {
      problems.push(`${label} applies_to "${role}", which this project does not compose — available: ${roles.join(', ')}`);
    }
  }
  if (applies.length === 1 && pill.dir && pill.dir !== 'shared' && pill.dir !== applies[0]) {
    problems.push(`${label} applies only to "${applies[0]}" but sits in ${pill.dir}/ — ${applies[0]} never reads it`);
  }
  if (applies.length === 1 && pill.dir === 'shared') {
    notes.push(`${label} applies to one role — it belongs in ${applies[0]}/, not shared/`);
  }
  if (applies.length > 1 && pill.dir && pill.dir !== 'shared') {
    const unreached = applies.filter((r) => r !== pill.dir);
    problems.push(`${label} declares ${applies.length} roles but sits in ${pill.dir}/ — ${unreached.join(', ')} never read it`);
  }

  // The filename sometimes repeats the role and sometimes does not, so both spellings of the
  // path-derived id are accepted. What is not accepted is an id that names some other pill.
  const base = pill.file.replace(/\.md$/, '');
  const accepted = base.startsWith(`${pill.dir}-`) ? [base, `${pill.dir}-${base}`] : [`${pill.dir}-${base}`];
  if (fields.id && !accepted.includes(fields.id)) {
    problems.push(`${label} has id "${fields.id}" — its path says "${accepted[0]}"`);
  }
  if (fields.severity && !SEVERITIES.includes(fields.severity)) {
    problems.push(`${label} has severity "${fields.severity}" — expected one of ${SEVERITIES.join(', ')}`);
  }
  if (fields.status && !STATUSES.includes(fields.status)) {
    problems.push(`${label} has status "${fields.status}" — expected one of ${STATUSES.join(', ')}`);
  }
  if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
    problems.push(`${label} has date "${fields.date}" — expected YYYY-MM-DD`);
  } else if (fields.date && fields.date > today) {
    problems.push(`${label} is dated ${fields.date}, which is in the future`);
  }
  if (fields.last_seen && !/^\d{4}-\d{2}-\d{2}$/.test(fields.last_seen)) {
    problems.push(`${label} has last_seen "${fields.last_seen}" — expected YYYY-MM-DD`);
  } else if (fields.last_seen && fields.date && fields.last_seen < fields.date) {
    problems.push(`${label} was last seen ${fields.last_seen}, before it was first learned (${fields.date})`);
  }
  if (fields.occurrences !== undefined && !/^[1-9]\d*$/.test(fields.occurrences)) {
    problems.push(`${label} has occurrences "${fields.occurrences}" — expected a positive whole number`);
  }

  // `citations` must be a field because a machine reads them back; `source` is read by a person,
  // so it counts wherever it sits — the format has always closed the body with it.
  const citations = list(fields.citations);
  const source = Boolean(fields.source) || /^source:\s*\S/m.test(text);
  if (citations.length === 0 && !source) {
    problems.push(`${label} carries no evidence — give it citations, a source, or both`);
  }
  for (const citation of citations) {
    if (!CITATION.test(citation)) {
      problems.push(`${label} cites "${citation}" — expected path or path:line`);
    }
  }

  return { problems, notes, fields, label, citations, uncited: citations.length === 0 };
}

/**
 * `nina pills`.
 *
 * @param {string[]} argv - Command arguments; `--project <dir>` selects the target.
 * @param {{root: string}} [ctx] - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function pills(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  const quiet = argv.includes('--quiet');
  const pillsDir = join(target, '.claude', 'pills');
  const agentsDir = join(target, '.claude', 'agents');

  if (!existsSync(agentsDir)) {
    console.error(`  no .claude/agents under ${target} — run \`nina compose\` first.\n`);
    return 1;
  }
  const roles = (await readdir(agentsDir))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();

  const today = new Date().toISOString().slice(0, 10);
  const files = existsSync(pillsDir) ? await pillFiles(pillsDir) : [];

  // The directory itself is composed, so its presence says nothing. An empty corpus is the
  // normal state of a new project and the suspicious state of an old one — say which, and
  // leave the judgement to whoever knows how long the pipeline has been running.
  if (files.length === 0) {
    if (!quiet) console.log(`  no pill written yet under ${target} — either nothing has been learned the expensive way, or nothing was written down.\n`);
    return 0;
  }
  const problems = [];
  const notes = [];
  const active = [];
  let retired = 0;
  let uncited = 0;

  // Knowing where a recurring lesson should go means knowing which roles exist only because
  // of a surface, and composition strips that gate — so it has to come from the layers.
  let gates = null;
  try {
    const profile = JSON.parse(await readFile(join(target, HARNESS, 'profile.json'), 'utf8'));
    const layers = layerRootFor(ctx?.root ?? '.', profile.core);
    if (!layers.error) gates = await roleGates(layers.dir);
  } catch {
    /* without a profile the candidate is still worth naming; only its target is unknown */
  }

  const changedCache = new Map();
  const candidates = [];
  let resolved = 0;
  let cited = 0;

  for (const pill of files) {
    const result = validate(pill, await readFile(pill.path, 'utf8'), roles, today);
    problems.push(...result.problems);
    notes.push(...result.notes);
    if (result.uncited) uncited += 1;
    if (result.fields?.status === 'retired') retired += 1;
    else active.push({ ...pill, date: result.fields?.date });

    const seen = Number(result.fields?.occurrences ?? 1);
    if (result.fields?.status !== 'retired' && seen >= GRADUATION_AT) {
      candidates.push({ label: result.label, seen, applies: list(result.fields?.applies_to) });
    }

    // A citation is the only part of a pill that can be checked against the world, which is
    // why the format asks for one. Checking it is the whole point of having asked.
    for (const citation of result.citations) {
      cited += 1;
      const at = resolveCitation(target, citation);
      if (at.state === 'gone') {
        problems.push(`${result.label} cites ${citation}, which no longer exists`);
        continue;
      }
      if (at.state === 'truncated') {
        problems.push(`${result.label} cites ${citation}, but ${at.path} has only ${at.lines} line(s)`);
        continue;
      }
      resolved += 1;
      if (!result.fields?.date) continue;
      if (!changedCache.has(at.path)) changedCache.set(at.path, lastChanged(target, at.path));
      const changed = changedCache.get(at.path);
      if (changed && changed > result.fields.date) {
        notes.push(
          `${result.label} cites ${at.path}, which changed on ${changed} — after the pill was written on ${result.fields.date}. Verify before trusting it.`,
        );
      }
    }
  }
  if (cited > 0) notes.push(`${resolved} of ${cited} citation(s) still resolve`);

  // A lesson learned three times is not a correction any more; it is a rule nobody wrote down.
  for (const c of candidates) {
    const target = gates && c.applies.length > 0 ? graduationTarget(c.applies, gates) : null;
    notes.push(
      `${c.label} has recurred ${c.seen} times — that is a rule, not a pill.` +
        (target ? ` Its home is ${target.layer}, since ${target.why}.` : '') +
        ' Write it there, then set this pill retired.',
    );
  }

  // One line, not one per pill: what matters is how much of the corpus a staleness check
  // could ever reach, and naming eleven files says that worse than counting them.
  if (uncited > 0) {
    notes.push(`${uncited} of ${files.length} pill(s) cite no code, so staleness cannot be checked mechanically`);
  }

  const covered = new Set(files.flatMap((p) => (p.dir && p.dir !== 'shared' ? [p.dir] : [])));
  const uncovered = roles.filter((r) => !covered.has(r));
  if (uncovered.length > 0 && files.length > 0) {
    notes.push(`no pill has ever been written for ${uncovered.join(', ')}`);
  }
  const dated = active.map((p) => p.date).filter(Boolean).sort();
  if (dated.length > 0) notes.push(`oldest active pill is ${dated[0]}, newest ${dated[dated.length - 1]}`);

  if (!(quiet && problems.length === 0)) {
    console.log(`  ${files.length} pill(s): ${active.length} active, ${retired} retired\n`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    for (const n of notes) console.log(`  · ${n}`);
    if (problems.length === 0 && notes.length === 0) console.log('  ✓ every pill is well formed, placed where it is read, and carries evidence');
    console.log(
      problems.length === 0
        ? `\npills: all ${files.length} well formed${notes.length > 0 ? ` (${notes.length} note(s))` : ''}\n`
        : `\npills: ${problems.length} problem(s)\n`,
    );
  }
  return problems.length === 0 ? 0 : 1;
}
