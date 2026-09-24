/**
 * `nina check` — validates a project's harness declaration.
 *
 * `compose --check` answers "does the output match the layers?". This answers the question
 * before it: "is what this project declared about itself true?". A profile is the only
 * input the whole composition trusts, and nothing else verifies it — a surface that does
 * not exist, a vocabulary entry nobody fills, an integration declared with no doc behind
 * it, all compose perfectly well and quietly produce a harness that says the wrong thing.
 */

import { readFile, readdir } from 'node:fs/promises';
import { HARNESS, legacyHint } from '../paths.mjs';
import { expectedUnfilled } from '../expected.mjs';
import { parseGraph, validateGraph } from '../graph.mjs';
import { installedSkills, toolFindings } from '../tools.mjs';
import { HOOK_SCRIPTS, missingWiring, shippedScripts } from '../wiring.mjs';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { REQUIRES, SLOT, layerRootFor, walk } from './compose.mjs';
import { defaultVocabulary } from '../vocabulary.mjs';

/** Fields every declared integration must carry, and why each one matters. */
const INTEGRATION_FIELDS = {
  slug: 'names the doc at .claude/integrations/<slug>.md',
  name: 'what the agent calls it in a report',
  kind: 'decides what counts as evidence for a premise',
  boundary: 'the one module allowed to speak to it',
};

/** The kinds an integration may declare. */
const KINDS = ['installed-library', 'live-api', 'platform-binding'];

/**
 * Every `{{PLACEHOLDER}}` the chosen layers reference.
 *
 * The project's own layer counts. It did not, and the omission was not cosmetic: `upgrade`
 * reports vocabulary nothing references so it can be dropped, and it named fifteen entries of
 * which two were used by the project's own fragments. Deleting on that advice composed
 * `{{PROVIDER}}` into a live reviewer spec.
 *
 * @param {string} layerRoot - Where the core and surfaces are read from.
 * @param {string[]} surfaces - The declared surfaces.
 * @param {string} [target] - The project, whose own layer references vocabulary too.
 * @returns {Promise<Set<string>>}
 */
export async function referencedVocabulary(layerRoot, surfaces, target) {
  const coreTree = join(layerRoot, 'core', 'tree');
  const found = new Set();
  for (const rel of await walk(coreTree)) {
    const core = await readFile(join(coreTree, rel), 'utf8');
    const requires = REQUIRES.exec(core);
    if (requires && !surfaces.includes(requires[1])) continue;
    const texts = [core];
    for (const s of surfaces) {
      const t = await readFile(join(layerRoot, 'surfaces', s, 'tree', rel), 'utf8').catch(() => null);
      if (t !== null) texts.push(t);
    }
    for (const [, name] of texts.join('\n').matchAll(/\{\{([A-Z_]+)\}\}/g)) found.add(name);
  }
  if (target) {
    const projectTree = join(target, HARNESS, 'project', 'tree');
    for (const rel of await walk(projectTree)) {
      const text = await readFile(join(projectTree, rel), 'utf8');
      for (const [, name] of text.matchAll(/\{\{([A-Z_]+)\}\}/g)) found.add(name);
    }
  }
  return found;
}

/**
 * Every project slot the chosen layers leave open, as `<relative path> <slot id>`.
 *
 * @param {string} layerRoot - Where the core is read from.
 * @param {string[]} surfaces - The declared surfaces.
 * @returns {Promise<Set<string>>}
 */
export async function projectSlots(layerRoot, surfaces) {
  const coreTree = join(layerRoot, 'core', 'tree');
  const slots = new Set();
  for (const rel of await walk(coreTree)) {
    const core = await readFile(join(coreTree, rel), 'utf8');
    const requires = REQUIRES.exec(core);
    if (requires && !surfaces.includes(requires[1])) continue;
    for (const line of core.split('\n')) {
      const marker = SLOT.exec(line);
      if (marker?.[1].startsWith('project.')) slots.add(`${rel} ${marker[1]}`);
    }
  }
  return slots;
}

/**
 * Every slot a project's own layer fills.
 *
 * @param {string} target - The project directory.
 * @returns {Promise<Set<string>>}
 */
export async function filledSlots(target) {
  const tree = join(target, HARNESS, 'project', 'tree');
  const filled = new Set();
  for (const rel of await walk(tree)) {
    for (const line of (await readFile(join(tree, rel), 'utf8')).split('\n')) {
      const marker = SLOT.exec(line);
      if (marker) filled.add(`${rel} ${marker[1]}`);
    }
  }
  return filled;
}


/**
 * Documents the chosen layers tell an agent to read, that no layer provides.
 *
 * `.claude/architecture.md` and the code map are written by the project, not composed — they
 * describe one system, so no layer could hold them. That is fine; what is not fine is that
 * nothing said so. The core referenced them 21 times and a freshly composed project had none
 * of them, so nine of those references pointed at a file that was never going to exist.
 *
 * Derived rather than listed: whatever the layers reference and do not supply is what the
 * project owes. A new reference added to the core starts being asked for on its own.
 *
 * @param {string} layerRoot - Where the core and surfaces are read from.
 * @param {string[]} surfaces - The declared surfaces.
 * @returns {Promise<Map<string, number>>} Path to how many times it is referenced.
 */
export async function owedDocuments(layerRoot, surfaces) {
  const roots = [join(layerRoot, 'core', 'tree'), ...surfaces.map((s) => join(layerRoot, 'surfaces', s, 'tree'))];
  const provided = new Set();
  const texts = [];
  for (const root of roots) {
    for (const rel of await walk(root)) {
      provided.add(rel);
      texts.push(await readFile(join(root, rel), 'utf8'));
    }
  }
  const owed = new Map();
  for (const [, ref] of texts.join('\n').matchAll(/`(\.claude\/[A-Za-z0-9_./-]+\.md)`/g)) {
    if (ref.includes('*') || provided.has(ref)) continue;
    owed.set(ref, (owed.get(ref) ?? 0) + 1);
  }
  return owed;
}

/**
 * `nina check`.
 *
 * @param {string[]} argv - Command arguments; `--project <dir>` selects the target.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
/**
 * Composed scripts that nothing in the project runs.
 *
 * A layer can compose an executable, and `scripts/harness-check.mjs` is one: it holds the
 * drift detectors a Stop hook fires every turn. Composing it is not the same as wiring it —
 * a new project gets the file and no npm script that runs it, so it sits there being correct
 * and doing nothing, and no check notices because nothing is missing.
 *
 * Matched by the file's own path appearing in a script's command, which is how a package
 * manager would reach it, so a project is free to name the script whatever it likes.
 *
 * @param {string} layerRoot - Where the layers are read from.
 * @param {string[]} surfaces - The declared surfaces.
 * @param {string} target - The project.
 * @returns {Promise<string[]>} Relative paths of composed scripts nothing invokes.
 */
export async function unwiredScripts(layerRoot, surfaces, target) {
  const roots = [join(layerRoot, 'core', 'tree'), ...surfaces.map((s) => join(layerRoot, 'surfaces', s, 'tree'))];
  const composed = new Set();
  for (const root of roots) {
    for (const rel of await walk(root)) {
      if (rel.startsWith(`scripts${sep}`) && /\.(mjs|cjs|js)$/.test(rel)) composed.add(rel);
    }
  }
  if (composed.size === 0) return [];

  let commands = [];
  try {
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    commands = Object.values(pkg.scripts ?? {});
  } catch {
    // No manifest at all is a different conversation; nothing here can be wired either way.
    return [];
  }
  // A script a hook runs is asked for by `missingWiring`, hook by hook — and with the npm scripts it
  // does need — so it is not also reported here as one no npm script runs.
  return [...composed]
    .filter((rel) => !HOOK_SCRIPTS.has(rel.split(sep).join('/')))
    .filter((rel) => !commands.some((c) => String(c).includes(rel)))
    .sort();
}

export async function check(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  // `--detector`: run by every project's harness:check. Inside `nina upgrade --apply` the move measures
  // this same check itself, before and after, as its own step; the detector saying it again, measured
  // against an old harness-check that never ran it, read every problem the project already had as one
  // the move made, and rolled the move back — `--force` or not.
  const detector = argv.includes('--detector');
  if (detector && process.env.NINA_UPGRADE) {
    console.log('check: declaration is sound (measured by the upgrade itself)');
    return 0;
  }

  const expected = expectedUnfilled(argv);
  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    const hint = legacyHint(target);
    console.error(`  no .nina/profile.json under ${target}${hint || ' — run `nina init` first.'}\n`);
    return 1;
  }

  /** Things that make the composition wrong. */
  const problems = [];
  /** Things that are merely stale — worth saying, not worth failing. */
  const notes = [];

  let profile;
  try {
    profile = JSON.parse(await readFile(profilePath, 'utf8'));
  } catch (error) {
    console.error(`  .nina/profile.json is not valid JSON: ${error.message}\n`);
    return 1;
  }

  const resolved = layerRootFor(ctx.root, profile.core);
  if (resolved.error) {
    console.error(`  ${resolved.error}\n`);
    return 1;
  }

  const surfaces = profile.surfaces ?? [];
  const available = (await readdir(join(resolved.dir, 'surfaces'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const s of surfaces) {
    if (!available.includes(s)) {
      problems.push(`surface "${s}" does not exist in core ${profile.core} — available: ${available.join(', ')}`);
    }
  }
  for (const s of new Set(surfaces)) {
    if (surfaces.filter((x) => x === s).length > 1) notes.push(`surface "${s}" is declared more than once`);
  }

  const referenced = await referencedVocabulary(resolved.dir, surfaces.filter((s) => available.includes(s)), target);
  const declared = profile.vocabulary ?? {};
  const defaults = defaultVocabulary(resolved.dir);
  for (const name of [...referenced].sort()) {
    if (!(name in declared)) {
      if (!(name in defaults)) problems.push(`vocabulary is missing {{${name}}}, which a chosen layer uses`);
    } else if (declared[name] === null || declared[name] === '') {
      problems.push(`vocabulary {{${name}}} is declared but not filled in`);
    }
  }
  for (const name of Object.keys(declared).sort()) {
    if (!referenced.has(name)) notes.push(`vocabulary {{${name}}} is declared but nothing references it`);
  }

  const integrations = profile.integrations ?? [];
  if (surfaces.includes('integrations') && integrations.length === 0) {
    notes.push('the integrations surface is declared but no integration is — the gates have nothing to fire on');
  }
  if (!surfaces.includes('integrations') && integrations.length > 0) {
    problems.push(`${integrations.length} integration(s) declared, but the "integrations" surface is not`);
  }
  for (const [i, entry] of integrations.entries()) {
    const label = entry?.slug ? `integration "${entry.slug}"` : `integration #${i + 1}`;
    for (const [field, why] of Object.entries(INTEGRATION_FIELDS)) {
      if (!entry?.[field]) problems.push(`${label} has no "${field}" — it ${why}`);
    }
    if (entry?.kind && !KINDS.includes(entry.kind)) {
      problems.push(`${label} has kind "${entry.kind}" — expected one of ${KINDS.join(', ')}`);
    }
    if (entry?.slug && !existsSync(join(target, '.claude', 'integrations', `${entry.slug}.md`))) {
      problems.push(`${label} has no doc at .claude/integrations/${entry.slug}.md — a premise has nowhere to live`);
    }
    if (entry?.boundary && !existsSync(join(target, entry.boundary))) {
      notes.push(`${label} names boundary "${entry.boundary}", which does not exist yet`);
    }
  }

  const slots = await projectSlots(resolved.dir, surfaces);
  const filled = await filledSlots(target);
  const open = [...slots].filter((s) => !filled.has(s));
  const missing = open.filter((s) => !expected.has(s));
  const awaited = open.filter((s) => expected.has(s));
  const orphan = [...filled].filter((s) => !slots.has(s));
  if (missing.length > 0) problems.push(`${missing.length} project slot(s) have no fragment — see .nina/TODO.md`);
  for (const s of awaited) notes.push(`project slot ${s} is new in this core and still to fill`);

  for (const [doc, refs] of await owedDocuments(resolved.dir, surfaces)) {
    if (existsSync(join(target, doc))) continue;
    problems.push(`${doc} does not exist, and the chosen layers tell an agent to read it ${refs} time(s)`);
  }
  for (const s of orphan) notes.push(`project fragment ${s} fills a slot core ${profile.core} does not have`);

  for (const rel of await unwiredScripts(resolved.dir, surfaces, target)) {
    notes.push(`${rel} is composed but no npm script runs it — nothing will ever execute it`);
  }

  // Asked per script the pinned version composes: a project is never told to wire what it does not have.
  for (const w of await missingWiring(target, await shippedScripts(resolved.dir, surfaces))) problems.push(w);

  // The pipeline graph, checked as the project composed it: which stages exist is what the
  // profile decides, so the layers alone cannot answer it. Only asked of a core that ships one.
  if (existsSync(join(resolved.dir, 'core', 'tree', '.claude', 'graph.md'))) {
    const graphPath = join(target, '.claude', 'graph.md');
    if (!existsSync(graphPath)) {
      problems.push('.claude/graph.md is not composed — run `nina compose`');
    } else {
      const agentsDir = join(target, '.claude', 'agents');
      const specs = new Map();
      // Only the specs the harness composed are stages. A project may keep agents of its own beside
      // them; they are outside the pipeline graph, not a stage the graph forgot.
      for (const file of (await readdir(agentsDir).catch(() => [])).filter((f) => f.endsWith('.md'))) {
        const text = await readFile(join(agentsDir, file), 'utf8');
        if (text.includes('nina:generated')) specs.set(file.replace(/\.md$/, ''), text);
      }
      // A core with a graph and no agent specs has no roles to name — an empty set, not a crash that
      // `upgrade` would read as a new failure and roll a move back for.
      const roles = new Set(
        (await readdir(join(resolved.dir, 'core', 'tree', '.claude', 'agents')).catch(() => [])).map((f) => f.replace(/\.md$/, '')),
      );
      for (const problem of validateGraph(parseGraph(await readFile(graphPath, 'utf8')), specs, roles)) {
        problems.push(`graph: ${problem}`);
      }
      // Which skills are installed is a fact about one machine, not about the project, so the detector —
      // which speaks before every prompt — leaves that half to a `nina check` run by hand.
      for (const finding of toolFindings(specs, detector ? null : await installedSkills(target))) problems.push(`tools: ${finding}`);
    }
  }

  for (const p of problems) console.log(`  ✗ ${p}`);
  for (const n of notes) console.log(`  · ${n}`);
  if (problems.length === 0 && notes.length === 0) console.log('  ✓ profile, vocabulary, integrations and project layer all check out');
  console.log(
    problems.length === 0
      ? `\ncheck: declaration is sound${notes.length > 0 ? ` (${notes.length} note(s))` : ''}\n`
      : `\ncheck: ${problems.length} problem(s)\n`,
  );
  return problems.length === 0 ? 0 : 1;
}
