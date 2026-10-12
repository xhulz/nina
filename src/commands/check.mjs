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
import { deferredWhy, describeMove, HARNESS, interruptedMove, readProfile, surfacesIn } from '../paths.mjs';
import { expectedUnfilled } from '../expected.mjs';
import { parseGraph, validateGraph } from '../graph.mjs';
import { frontmatterFindings, installedSkills, modelFindings, toolFindings } from '../tools.mjs';
import { HOOK_SCRIPTS, missingWiring, shippedScripts } from '../wiring.mjs';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { SLOT, closedGate, defaultedSlots, layerRootFor, noticeOf, readLayerText, stripWhy, walk } from './compose.mjs';
import { PLACEHOLDER, defaultVocabulary } from '../vocabulary.mjs';
import { missingNeeds } from '../surfaces.mjs';
import { resolveCitation } from './pills.mjs';

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
    if (closedGate(core, surfaces)) continue;
    const texts = [core];
    for (const s of surfaces) {
      const t = await readFile(join(layerRoot, 'surfaces', s, 'tree', rel), 'utf8').catch(() => null);
      if (t !== null) texts.push(t);
    }
    for (const [, name] of stripWhy(texts.join('\n')).matchAll(PLACEHOLDER)) found.add(name);
  }
  if (target) {
    const projectTree = join(target, HARNESS, 'project', 'tree');
    for (const rel of await walk(projectTree)) {
      const text = stripWhy((await readLayerText(join(projectTree, rel))) ?? '');
      for (const [, name] of text.matchAll(PLACEHOLDER)) found.add(name);
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
    if (closedGate(core, surfaces)) continue;
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
    for (const line of ((await readLayerText(join(tree, rel))) ?? '').split('\n')) {
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
      texts.push(stripWhy(await readFile(join(root, rel), 'utf8')));
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

const STORE = 'node_modules/.pnpm/';
const PATH_CHAR = /[\w.@+\-/]/;
const STORE_DIR = `${sep}node_modules${sep}.pnpm${sep}`;

/** The project's root and every directory two levels down holding a package.json: where a package links its deps. */
function packageDirs(target) {
  const dirs = [target];
  const visit = (dir, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const sub = join(dir, entry.name);
      if (existsSync(join(sub, 'package.json'))) dirs.push(sub);
      if (depth > 1) visit(sub, depth - 1);
    }
  };
  visit(target, 2);
  return dirs;
}

/** The libraries a `node_modules` directory links, scoped ones included. */
function linksIn(modules) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(modules);
  } catch {
    return out;
  }
  for (const name of entries.filter((entry) => !entry.startsWith('.'))) {
    if (!name.startsWith('@')) out.push(join(modules, name));
    else {
      try {
        for (const inner of readdirSync(join(modules, name))) out.push(join(modules, name, inner));
      } catch {
        // Not a scope after all.
      }
    }
  }
  return out;
}

/**
 * Each store's directories the install uses: those a package links, and every one they link in turn. What is left
 * is what a peer change renamed away, kept on disk and linked by nothing.
 *
 * @param {string} target - The project directory.
 * @returns {Map<string, Set<string>>} Store directory (real path) → the names in it still in use.
 */
function liveStoreDirs(target) {
  const live = new Map();
  const queue = [];
  const reach = (link) => {
    let real;
    try {
      real = realpathSync(link);
    } catch {
      return;
    }
    const at = real.indexOf(STORE_DIR);
    if (at === -1) return;
    const store = real.slice(0, at + STORE_DIR.length - 1);
    const name = real.slice(at + STORE_DIR.length).split(sep)[0];
    if (!live.has(store)) live.set(store, new Set());
    if (live.get(store).has(name)) return;
    live.get(store).add(name);
    queue.push(join(store, name, 'node_modules'));
  };
  for (const dir of packageDirs(target)) for (const link of linksIn(join(dir, 'node_modules'))) reach(link);
  while (queue.length > 0) for (const link of linksIn(queue.pop())) reach(link);
  return live;
}

/**
 * A text with its fenced blocks blanked. What a command printed, quoted as evidence, cites nothing: re-citing a path
 * in it would falsify the evidence, and a note that cannot be cleared trains its reader to skip the check, the
 * citations it is right about included. One project's `readlink` transcript held a store directory a peer change
 * had since renamed. A fence left open runs to the end, as Markdown reads it.
 *
 * @param {string} text
 * @returns {string}
 */
export function outsideFences(text) {
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      if (fence) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
        if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
        return '';
      }
      // Indented any depth, since a list item's fence is indented past the marker; and a backtick run whose rest
      // holds a backtick is code in a line, not a fence.
      const [, open, info] = /^\s*(`{3,}|~{3,})(.*)$/.exec(line) ?? [];
      fence = open && !(open[0] === '`' && info.includes('`')) ? open : null;
      return fence ? '' : line;
    })
    .join('\n');
}

/**
 * The paths into the package manager's store that a text cites and the install no longer uses. Only the store: its
 * directory names carry a suffix per peer, renamed when an unrelated dependency changes one, and the old directory
 * stays on disk, linked by nothing — so a citation still opens on the machine that wrote it. A store path is stale
 * when its file is gone, or when its directory is not among those the install reaches from the packages' own links
 * (the root and packages two levels down); a store nothing reaches is judged by the file alone. A path through a
 * package's own link, or one written from some package's directory, cannot be told stale from here. A line number
 * after a path is not part of it; an elision (`...`, `…`), a template and a URL are not citations. Each occurrence of
 * the store is read outwards, and the next is looked for past it, so the text is read once. A directory that is not
 * `<name>@<version>` is a mention of the store, not a citation, except its hoisting `node_modules`. A path in a fenced
 * block is quoted output, not a citation (`outsideFences`).
 *
 * @param {string} text
 * @param {string} target - The project directory.
 * @param {Map<string, Map<string, Set<string>>>} [reached] - What the install reaches, by project, kept between
 *   the docs of one run so the store is walked once.
 * @returns {string[]} Each stale path once, in the order cited.
 */
export function unresolvedCitations(written, target, reached = new Map()) {
  const text = outsideFences(written);
  const cited = new Set();
  let at = text.indexOf(STORE);
  while (at !== -1) {
    let start = at;
    while (start > 0 && PATH_CHAR.test(text[start - 1])) start -= 1;
    let end = at + STORE.length;
    while (end < text.length && PATH_CHAR.test(text[end])) end += 1;
    const path = text.slice(start, end).replace(/[/.]+$/, '');
    const url = text[start - 1] === ':' && path.startsWith('//');
    const elided = text[start - 1] === '…' || text[end] === '…' || path.includes('...');
    const template = text[end] === '<';
    // A store directory is `<name>@<version>`, or the store's own `node_modules`, where it hoists; anything else
    // (`resend@*`, a name cut short) mentions the store, and cites nothing in it.
    const dir = path.slice(path.indexOf(STORE) + STORE.length).split('/')[0];
    const named = dir === 'node_modules' || /^(?:@[^+@]+\+)?[^@]+@\w/.test(dir);
    if (!url && !elided && !template && named) cited.add(path);
    at = text.indexOf(STORE, end);
  }
  if (cited.size === 0) return [];
  if (!reached.has(target)) reached.set(target, liveStoreDirs(target));
  const live = reached.get(target);
  const stale = (path) => {
    const from = path.indexOf(STORE);
    const [dir, ...rest] = path.slice(from + STORE.length).split('/');
    // The store the citation names: the one under the directory it is written in (a spike's own), else the
    // project's — an absolute path from another machine, or `../../` from a package's directory, leads there.
    const prefix = path.startsWith('/') ? '' : path.slice(0, from).replace(/^(?:\.\.?\/)+/, '');
    const named = join(target, prefix, 'node_modules', '.pnpm');
    if (!existsSync(join(named, dir, ...rest))) return true;
    // The store's hoisting directory is no package of its own: there, only whether the file is.
    if (dir === 'node_modules') return false;
    let store;
    try {
      store = realpathSync(named);
    } catch {
      return true;
    }
    const used = live.get(store);
    return Boolean(used) && !used.has(dir);
  };
  return [...cited].filter(stale);
}

/**
 * `<package dir>/node_modules/<parent> → <lib>@<version>/<file>[:<line>]`: a library no package of the project links,
 * cited through the package that depends on it.
 */
const TRANSITIVE = /(\/?(?:[\w.@+-]+\/)*node_modules\/(?:@[\w.-]+\/)?[\w.-]+)\s*(?:→|->)\s*((?:@[\w.-]+\/)?[\w.-]+)@(\d[\w.+-]*)\/([^\s:`|),;]*[^\s:`|),;.])(?::(\d+))?/g;

/**
 * Where Node finds a library from a directory: the `node_modules` beside each directory up from it, one that is a
 * `node_modules` itself skipped. From a package's real path in the store, that is the directory its dependencies are
 * linked in.
 *
 * @param {string} from - A real path.
 * @param {string} lib - The library's name, scoped or not.
 * @returns {string|null} The library's real path.
 */
function resolveFrom(from, lib) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', lib);
    if (basename(dir) !== 'node_modules' && existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The citations of a library through its parent's link that do not resolve as written. A dependency of a dependency
 * has no link of its own in any package — the emulator one project's every database premise was about is a dependency
 * of its CLI, not of the project — and its only other path is a store directory a peer change renames. So it is cited
 * through the parent's link, and resolved from where that link really leads, as Node resolves it: the parent there,
 * the library found from it at the version written, the file in it, and the line within it.
 *
 * @param {string} text
 * @param {string} target - The project directory the package directories are relative to.
 * @returns {string[]} Each citation that does not resolve, with why, once.
 */
export function transitiveCitations(text, target) {
  const wrong = new Map();
  for (const [cited, parent, lib, version, file, line] of outsideFences(text).matchAll(TRANSITIVE)) {
    if (wrong.has(cited)) continue;
    let real;
    try {
      real = realpathSync(isAbsolute(parent) ? parent : join(target, parent));
    } catch {
      wrong.set(cited, `${parent} is not there`);
      continue;
    }
    const found = resolveFrom(real, lib);
    let installed = null;
    try {
      installed = found ? JSON.parse(readFileSync(join(found, 'package.json'), 'utf8')).version ?? null : null;
    } catch {
      // A manifest that does not parse says no version.
    }
    if (!found) wrong.set(cited, `${lib} does not resolve from it`);
    else if (installed !== version) wrong.set(cited, `${lib} resolves to ${installed ?? 'no version'} there`);
    else {
      const at = resolveCitation(found, line ? `${file}:${line}` : file);
      if (at.state === 'gone') wrong.set(cited, `${file} is not in ${lib}@${version}`);
      else if (at.state === 'truncated') wrong.set(cited, `${file} has ${at.lines} line(s)`);
    }
  }
  return [...wrong].map(([cited, why]) => `${cited}: ${why}`);
}

/**
 * `nina check`.
 *
 * @param {string[]} argv - Command arguments; `--project <dir>` selects the target.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
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
  const { profile, error } = readProfile(target);
  if (error) {
    console.error(`  ${error}\n`);
    return 1;
  }

  /** Things that make the composition wrong. */
  const problems = [];
  /** Things that are merely stale — worth saying, not worth failing. */
  const notes = [];

  const resolved = layerRootFor(ctx.root, profile.core);
  if (resolved.error) {
    console.error(`  ${resolved.error}\n`);
    return 1;
  }

  // The move measures this check itself while its journal is written, and that journal is not a problem then.
  const stopped = process.env.NINA_UPGRADE ? null : interruptedMove(target);
  if (stopped) problems.push(`${describeMove(stopped)} \`nina upgrade --abort\` undoes it`);

  const surfaces = profile.surfaces ?? [];
  const available = (await surfacesIn(resolved.dir));
  for (const s of surfaces) {
    if (!available.includes(s)) {
      problems.push(`surface "${s}" does not exist in core ${profile.core} — available: ${available.join(', ')}`);
    }
  }
  for (const s of new Set(surfaces)) {
    if (surfaces.filter((x) => x === s).length > 1) notes.push(`surface "${s}" is declared more than once`);
    const missing = missingNeeds(s, surfaces);
    if (missing.length > 0) problems.push(`surface "${s}" is a stack of "${missing.join('" and "')}", which this profile does not declare — its rules have nowhere to land`);
  }

  // What the project has chosen to decide later, and why: a vocabulary name, a document or a project slot,
  // under "deferred" in the profile. It is said as a note rather than a problem, so a project that has not
  // made a decision yet — and says so — is not told on every turn that it has not. The first new project,
  // designing before it had code, was told the same five things before every message for days.
  const deferred = profile.deferred && typeof profile.deferred === 'object' ? profile.deferred : {};
  const deferredUsed = new Set();
  let deferrable = false;
  const owe = (key, problem) => {
    const why = deferredWhy(profile, key);
    if (why) {
      deferredUsed.add(key);
      notes.push(`deferred: ${key} — ${why}`);
    } else {
      deferrable = true;
      problems.push(problem);
    }
  };

  const referenced = await referencedVocabulary(resolved.dir, surfaces.filter((s) => available.includes(s)), target);
  const declared = profile.vocabulary ?? {};
  const defaults = defaultVocabulary(resolved.dir);
  for (const name of [...referenced].sort()) {
    const unanswered = !(name in declared) ? !(name in defaults) : declared[name] === null || declared[name] === '';
    if (unanswered && expected.has(`{{${name}}}`)) notes.push(`vocabulary {{${name}}} is new in this core and still to fill`);
    else if (!(name in declared)) {
      if (!(name in defaults)) owe(name, `vocabulary is missing {{${name}}}, which a chosen layer uses`);
    } else if (declared[name] === null || declared[name] === '') {
      owe(name, `vocabulary {{${name}}} is declared but not filled in`);
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
    // A client library over a platform binding is both kinds: its own behavior is cited from its installed
    // source, the binding's from the emulator, and one kind left half its premises with no form of evidence.
    const kinds = [entry?.kind].flat().filter((kind) => kind !== undefined && kind !== null && kind !== '');
    if (Array.isArray(entry?.kind) && kinds.length === 0) problems.push(`${label} has no "kind" — it ${INTEGRATION_FIELDS.kind}`);
    for (const kind of kinds) {
      if (!KINDS.includes(kind)) problems.push(`${label} has kind "${kind}" — expected one of ${KINDS.join(', ')}, or a list of them`);
    }
    if (new Set(kinds).size < kinds.length) notes.push(`${label} lists a kind more than once`);
    if (entry?.slug && !existsSync(join(target, '.claude', 'integrations', `${entry.slug}.md`))) {
      owe(`.claude/integrations/${entry.slug}.md`, `${label} has no doc at .claude/integrations/${entry.slug}.md — a premise has nowhere to live`);
    }
    if (entry?.boundary && !existsSync(join(target, entry.boundary))) {
      notes.push(`${label} names boundary "${entry.boundary}", which does not exist yet`);
    }
  }
  // The other direction: a doc no integration declares is retired, waits for its boundary, or lost its
  // declaration, and nothing told a reader which. Said as a note, and as a deferral once the profile says why.
  const declaredSlugs = new Set(integrations.map((entry) => entry?.slug));
  const docs = await readdir(join(target, '.claude', 'integrations')).catch(() => []);
  for (const doc of docs.filter((name) => name.endsWith('.md') && !declaredSlugs.has(name.slice(0, -'.md'.length))).sort()) {
    const key = `.claude/integrations/${doc}`;
    const why = deferredWhy(profile, key);
    if (why) deferredUsed.add(key);
    notes.push(why ? `deferred: ${key} — ${why}` : `${key} documents no declared integration — declare it, or say under "deferred" why not: retired, or waiting for its boundary`);
  }
  // A premise cites installed source by its path, and a path into the package manager's store dies when a peer
  // change renames the directory: the version and the file unchanged, the citation pointing where no fresh install
  // looks. Said per doc, so each premise is re-cited before anyone trusts it.
  const reached = new Map();
  for (const doc of docs.filter((name) => name.endsWith('.md')).sort()) {
    const key = `.claude/integrations/${doc}`;
    const text = await readFile(join(target, key), 'utf8').catch(() => '');
    const gone = unresolvedCitations(text, target, reached);
    if (gone.length > 0) {
      notes.push(
        `${key} cites ${gone.length} path(s) in the package manager's store that the install no longer uses — ${gone[0]}${gone.length > 1 ? ', …' : ''}: a peer change renames those directories, and the old one stays on disk linked by nothing; re-cite each from the depending package's own node_modules link, with its version beside it — or, for a library no package links, through the one that depends on it: \`<package dir>/node_modules/<parent> → <lib>@<version>/<file>:<line>\``,
      );
    }
    const wrong = transitiveCitations(text, target);
    if (wrong.length > 0) {
      notes.push(
        `${key} cites ${wrong.length} librar${wrong.length > 1 ? 'ies' : 'y'} through a parent's link that ${wrong.length > 1 ? 'do' : 'does'} not resolve as written — ${wrong[0]}${wrong.length > 1 ? '; …' : ''}: read where the parent's link leads, and cite the version, file and line found there`,
      );
    }
  }

  const slots = await projectSlots(resolved.dir, surfaces);
  const filled = await filledSlots(target);
  // A slot the release fills itself until the project does is not owed: it composes, and a project writes
  // one only to tailor it.
  const defaulted = await defaultedSlots(resolved.dir);
  const open = [...slots].filter((s) => !filled.has(s) && !defaulted.has(s));
  const missing = open.filter((s) => !expected.has(s) && !deferredWhy(profile, s));
  for (const s of open.filter((s) => !expected.has(s) && !missing.includes(s))) owe(s, `project slot ${s} has no fragment`);
  const awaited = open.filter((s) => expected.has(s));
  const orphan = [...filled].filter((s) => !slots.has(s));
  if (missing.length > 0) {
    deferrable = true;
    problems.push(`${missing.length} project slot(s) have no fragment — see .nina/TODO.md`);
  }
  for (const s of awaited) notes.push(`project slot ${s} is new in this core and still to fill`);

  const unwritten = new Set();
  for (const [doc, refs] of await owedDocuments(resolved.dir, surfaces)) {
    if (existsSync(join(target, doc))) continue;
    unwritten.add(doc);
    owe(doc, `${doc} does not exist, and the chosen layers tell an agent to read it ${refs} time(s)`);
  }
  for (const [key, why] of Object.entries(deferred)) {
    if (deferredUsed.has(key)) continue;
    if (typeof why !== 'string' || !why.trim()) problems.push(`"${key}" is deferred with no reason — say why it waits, or fill it`);
    else notes.push(`"${key}" is deferred, and nothing this check asks for goes by that name any more — remove it from "deferred"`);
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
        if (noticeOf(text) !== null) specs.set(file.replace(/\.md$/, ''), text);
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
      for (const finding of modelFindings(specs)) problems.push(`model: ${finding}`);
      // A project's own fragment can still take a line Claude Code needs out of the frontmatter.
      for (const finding of frontmatterFindings(specs)) problems.push(`frontmatter: ${finding}`);
    }
  }

  // A list of problems says what is missing, not where to begin, and a new project's first session met
  // eighteen of them at the same weight — while the brief that says what the project is sat unread. The
  // order is read off the work itself: until the architecture is written, it comes first, because most
  // of the vocabulary and the slots are decisions it makes; once it is, the order says nothing more. A
  // first version read it off the directory instead, and never noticed the architecture being written.
  if (problems.length > 0) {
    const brief = existsSync(join(target, HARNESS, 'BRIEF.md'));
    if (unwritten.has(join('.claude', 'architecture.md')) && detector) {
      // To the model, before its answer. Told the order, it still opened a new project's first session
      // with the inventory and offered to read the brief; what the owner wanted was an answer about
      // their project. The list stays below for the model, and in the TODO for everyone.
      console.log(
        '  → this project has no architecture yet, so the list below is not the conversation. ' +
          (brief
            ? 'Before you answer, read `.nina/BRIEF.md`, the owner\'s own description of the project, and open with it: say in a sentence what the project is, '
            : 'Before you answer, read what the project already says about itself — its README, its code — and open with that; if there is nothing to read, ask the owner what it is for and who it serves. Then ') +
          'propose writing `.claude/architecture.md` together, and ask the first question it raises. Do not recite the list: it is in `.nina/TODO.md`, and most of it is decided by that architecture.',
      );
    } else if (unwritten.has(join('.claude', 'architecture.md'))) {
      console.log(
        `  → start with the architecture, in this order: ${brief ? 'read `.nina/BRIEF.md`, the owner\'s description of the project, then ' : ''}` +
          'write `.claude/architecture.md` with the owner. The vocabulary and most project slots are decisions that architecture makes — fill them from it, then `nina compose`.',
      );
    } else if (brief) {
      console.log("  → `.nina/BRIEF.md` is the owner's description of the project — read it before filling anything below.");
    }
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  if (deferrable) {
    console.log('  → a decision this project has not made yet can wait: name it under "deferred" in .nina/profile.json, with why');
  }
  for (const n of notes) console.log(`  · ${n}`);
  if (problems.length === 0 && notes.length === 0) console.log('  ✓ profile, vocabulary, integrations and project layer all check out');
  console.log(
    problems.length === 0
      ? `\ncheck: declaration is sound${notes.length > 0 ? ` (${notes.length} note(s))` : ''}\n`
      : `\ncheck: ${problems.length} problem(s)\n`,
  );
  return problems.length === 0 ? 0 : 1;
}
