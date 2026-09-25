/**
 * `nina compose` — rebuilds a project's harness files from the core, the surfaces it
 * declares, and its own project layer.
 *
 * Each layer is a mirror of the project tree under `tree/`: `core/tree/CLAUDE.md`
 * composes to `<project>/CLAUDE.md`, `core/tree/.claude/agents/reviewer.md` to
 * `<project>/.claude/agents/reviewer.md`. The core carries the invariant text with two
 * kinds of hole — a `<!-- nina:slot x.n -->` marker, filled by the surface (or project)
 * fragment that declares it at the SAME relative path, and a `{{VOCABULARY}}`
 * placeholder, filled from the profile. A surface the project does not declare has its
 * markers dropped, so a project with no database never reads a word about Prisma.
 *
 * The test that keeps this honest is a recomposition of the project it was extracted
 * from: the output must be byte-identical to what is running. Anything weaker depends on
 * someone's judgement that no rule was lost, and judgement is what let a mandatory rule
 * sit unenforceable for three months here.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { HARNESS, legacyHint } from '../paths.mjs';
import { expectedUnfilled } from '../expected.mjs';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { defaultVocabulary } from '../vocabulary.mjs';

/**
 * Matches a slot marker on its own line, with an optional label.
 *
 * The label is documentation, not identity: a run of consecutive slots is indistinguishable
 * by position alone, and "fills the hole between project.1 and project.3" tells whoever has
 * to write it nothing about what belongs there. Matching keys on the id, so a fragment
 * written without the label still fills the slot.
 */
export const SLOT = /^<!-- nina:slot ([a-z-]+\.\d+)(?:\s+([^>]*?))?\s*-->$/;

/** A passage that tells why a rule exists as history: kept in the layers, dropped from what is composed. */
const WHY = /<!-- nina:why -->[\s\S]*?<!-- \/nina:why -->/g;

/**
 * A layer's text as it composes, less its `nina:why` passages — for every reader of the layers that
 * should see what a project gets rather than what the harness keeps: the vocabulary a project owes, the
 * documents it is asked for, the leak audit. Markers are matched as written, not parsed: a fenced code
 * block is no exception, so a layer does not show the marker as an example.
 *
 * @param {string} text - Layer text.
 * @param {{keepLines?: boolean}} [options] - `keepLines` leaves the newlines a passage held, so a line
 *   number read from the result is still the layer's.
 * @returns {string}
 */
export function stripWhy(text, { keepLines = false } = {}) {
  return String(text).replace(WHY, (passage) => (keepLines ? passage.replace(/[^\n]/g, '') : ''));
}

/**
 * Matches a file's surface precondition, on its first line.
 *
 * Some files are the surface: a `dba` exists because there is a database, an
 * `integration-tester` because there is an external service. Composing them into a
 * project that declares neither would hand it a gate with nothing to gate.
 */
export const REQUIRES = /^<!-- nina:requires ([a-z-]+) -->\n/;

/**
 * A slot inside a line — text before it, and the marker last. Filled with its fragment collapsed
 * to one line; dropped, like any slot, when its surface is not declared.
 */
const INLINE_SLOT = /<!-- nina:slot ([a-z-]+\.\d+)(?:\s+[^>]*?)?\s*-->/g;

/**
 * Matches YAML frontmatter at the very start of a file.
 *
 * Claude Code reads a subagent's `name`, `description` and `tools` from this block, and only
 * when the block opens the file. One character before the first `---` and the spec stops
 * being dispatchable, with nothing said about it anywhere — so the generated notice goes
 * below the block rather than above it.
 *
 * Two things the shape alone does not settle. A `\r\n` file would miss the match and take the
 * notice ABOVE its frontmatter — the exact silent break this exists to prevent — so the line
 * ending is optional. And a Markdown file may open with `---` as a horizontal rule, which is
 * not frontmatter at all; the lookahead asks the next line to be a `key:` before believing it.
 */
const FRONTMATTER = /^---\r?\n(?=[A-Za-z_][\w-]*[ \t]*:)[\s\S]*?\r?\n---\r?\n/;

/** A script's interpreter line, which is only an interpreter line at byte 0. */
const SHEBANG = /^#![^\n]*\r?\n/;

/** Files the notice can be written into, and the comment syntax each one takes. */
const SCRIPT = /\.(mjs|cjs|js)$/;

/**
 * The notice a composed file carries, so whoever opens it knows it is not the source.
 *
 * `compose --check` already reports a hand edit as drift, but it reports it late — after the
 * turn was spent, and only if something runs it before the next compose reverts the work in
 * silence. This is the same fact delivered while it can still change what happens: the `Edit`
 * tool refuses a file that was not read first, so every hand edit is preceded by a read of
 * the file, which makes the top of the file the one place a notice cannot be missed.
 *
 * It names the layer to edit instead of only forbidding the edit. An agent told "not here"
 * with nowhere to go either edits anyway or stalls. Where the core leaves no `project.*`
 * slot, the honest answer is that this project cannot change the text at all, and saying so
 * is what turns a silent hand edit into a reported finding.
 *
 * The slots are named rather than counted, with the labels the core gave them, because
 * "under the slot it belongs to" left the reader to go and find out which — and the labels
 * are the only thing that says which. What is deliberately NOT written here is the pinned
 * version: the notice's bytes would then change in every composed file on every upgrade, so
 * a project's diff after a move would be twenty files of stamp and one of substance. The
 * profile is named instead, which costs one read and never goes stale.
 *
 * @param {string} rel - The file's path, relative to the project root.
 * @param {string[]} slots - The `project.*` slots the core leaves in this file, each as its
 *   id and the label the core gave it, e.g. `project.2 role-intro`.
 * @param {boolean} [script] - Comment as code rather than as Markdown.
 * @returns {string} The notice, in the commenting syntax the file takes.
 */
export function generatedNotice(rel, slots, script = false) {
  // By number, not by position: a slot added later sits where the core file needed it, so
  // file order reads 1 2 3 4 8 5 6 7 and looks like a mistake in the very sentence whose job
  // is to be trusted.
  const named = (Array.isArray(slots) ? [...slots] : []).sort(
    (a, b) => Number(/\.(\d+)/.exec(a)?.[1] ?? 0) - Number(/\.(\d+)/.exec(b)?.[1] ?? 0),
  );
  const where = named.length > 0
    ? `This project's own text for it goes in ${HARNESS}/project/tree/${rel}, in one of these slots: ${named.join(' · ')}. Every other line comes from the installed harness and cannot be changed from this project`
    : `This file has no project-layer slot: every line of it comes from the installed harness and cannot be changed from this project`;
  const upstream = `A rule that should hold for every project is a request against the core version pinned in ${HARNESS}/profile.json, quoting this file and the line`;
  const body = `nina:generated — composed by \`nina compose\`. A hand edit here is reported as drift and overwritten by the next compose. ${where}. ${upstream} — say so in your report instead of editing here.`;

  // Wrapped here rather than written with newlines in place: the project path is part of the
  // sentence, so its length decides where the breaks fall and a hand-placed break is ragged
  // for every path but the one it was measured against.
  const lines = [];
  for (const word of body.split(' ')) {
    const line = lines.length - 1;
    if (lines.length === 0 || `${lines[line]} ${word}`.length > 88) lines.push(word);
    else lines[line] += ` ${word}`;
  }
  return script ? lines.map((line) => `// ${line}`).join('\n') : `<!-- ${lines.join('\n     ')} -->`;
}

/**
 * Puts the notice at the top of a composed file, below its frontmatter where it has any.
 *
 * @param {string} text - The composed text.
 * @param {string} rel - The file's path, relative to the project root.
 * @param {string[]} slots - The `project.*` slots the core leaves in this file, with labels.
 * @returns {string}
 */
export function stamp(text, rel, slots) {
  // Both preambles are only themselves at byte 0: a `#!` line one character in is a comment,
  // and the file stops being executable. Same hazard as frontmatter, same answer — the notice
  // goes below whichever one the file opens with.
  const script = SCRIPT.test(rel);
  const preamble = (script ? SHEBANG.exec(text) : FRONTMATTER.exec(text))?.[0] ?? '';
  const body = text.slice(preamble.length).replace(/^\n+/, '');
  return `${preamble}${generatedNotice(rel, slots, script)}\n\n${body}`;
}

/**
 * Where a project's layers are read from.
 *
 * A project pins a frozen release, or tracks the working tree with "dev". A pinned release
 * that is missing is an error, never a silent fall back to whatever the harness happens to
 * look like right now: that would compose an unreviewed core into a project that asked for
 * a reviewed one, and nothing downstream would say so.
 *
 * @param {string} root - The NINA install directory.
 * @param {string|undefined} core - The profile's `core` field.
 * @returns {{dir: string}|{error: string}}
 */
export function layerRootFor(root, core) {
  if (!core || core === 'dev') {
    // `dev` means "track the layers as they are being worked on", which only exists in a
    // checkout of this repo. An installed package ships frozen releases and nothing else,
    // so say that rather than composing an empty tree and reporting nothing wrong.
    if (!existsSync(join(root, 'core'))) {
      return { error: `profile pins core "dev", which tracks the NINA working tree — ${root} is an installed package and has only releases` };
    }
    return { dir: root };
  }
  const dir = join(root, 'releases', core);
  if (!existsSync(dir)) return { error: `profile pins core ${core}, which is not in ${join(root, 'releases')}` };
  return { dir };
}

/**
 * Orders release names by their numbers rather than as text.
 *
 * `['0.9.0', '0.10.0'].sort()` puts `0.9.0` last, because `'1' < '9'` one character in. The
 * newest release would stop being the newest at the first two-digit minor, and a command that
 * defaults to it — `init` pins one — would quietly choose the release before it.
 *
 * @param {string} a - A release name.
 * @param {string} b - Another.
 * @returns {number} Negative when `a` is older.
 */
export function byVersion(a, b) {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const one = left[i] ?? '0';
    const other = right[i] ?? '0';
    // A segment that is not a number has no place on the number line, and `NaN` from a
    // comparator is undefined behaviour for `sort` — in practice it floats the malformed name
    // to the end, where "the newest release" would then pick it. Falling back to text keeps
    // the order total, so a stray `README.md` in `releases/` sorts somewhere harmless.
    if (!/^\d+$/.test(one) || !/^\d+$/.test(other)) {
      return one < other ? -1 : one > other ? 1 : 0;
    }
    if (Number(one) !== Number(other)) return Number(one) - Number(other);
  }
  return 0;
}

/** Directories that are never part of a project's own source, nor of any layer. */
const SKIP = new Set(['node_modules', '.git']);

/**
 * Every file a layer's tree contains, as paths relative to that tree.
 *
 * @param {string} dir - The layer's `tree/` directory.
 * @returns {Promise<string[]>} Relative paths, depth-first.
 */
export async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const child = join(dir, entry.name);
    // `init` walks a whole project to work out which surfaces its files reveal, and a
    // dependency's example tree carries the same filenames — a `foundry.toml` or a
    // `schema.prisma` under `node_modules` would declare a surface the project does not have,
    // straight into its profile. No layer tree contains either directory, so skipping them
    // costs nothing and removes the false positive at its source.
    if (entry.isDirectory() && SKIP.has(entry.name)) continue;
    if (entry.isDirectory()) {
      for (const nested of await walk(child)) out.push(join(entry.name, nested));
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * Reads the fragments one layer declares for one file.
 *
 * Slot ids are scoped to the file, not to the layer: `db.1` in `reviewer.md` and `db.1`
 * in `dba.md` are different slots. Reading a whole layer into one map would make them
 * collide, and the collision would be silent — the last file read would win and a rule
 * would quietly move to the wrong place.
 *
 * @param {string} path - The fragment file in the layer's tree.
 * @returns {Promise<Map<string, string>>} slot id -> fragment text.
 */
async function readFragments(path) {
  const bySlot = new Map();
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) return bySlot;
  let current = null;
  const buffer = [];
  const flush = () => {
    if (current) bySlot.set(current, buffer.join('\n').replace(/\n+$/, ''));
    buffer.length = 0;
  };
  for (const line of text.split('\n')) {
    const marker = SLOT.exec(line);
    if (marker) {
      flush();
      current = marker[1];
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  // Each fragment on its own, so a marker left unclosed cannot reach past the slot it was written in.
  for (const [slot, fragment] of bySlot) bySlot.set(slot, stripWhy(fragment));
  return bySlot;
}

/**
 * Where a release keeps its own text for a project slot the file cannot do without, as fragments in the
 * same form a project writes. The one that needed it is an agent spec's `description:` line: the core left
 * it to the project, and until the project wrote it the spec composed with no description — which Claude
 * Code reads as no agent at all, so a new project had no reviewer, qa or secops, and nothing said so. The
 * project's own fragment still wins; the release's composes only until there is one.
 *
 * @param {string} layerRoot - The release, or the working tree.
 * @returns {string}
 */
export const defaultsTree = (layerRoot) => join(layerRoot, 'core', 'defaults', 'tree');

/**
 * The project slots a release fills itself until the project does, as `<relative path> <slot id>`.
 * A release from before there were any has none.
 *
 * @param {string} layerRoot - The release, or the working tree.
 * @returns {Promise<Set<string>>}
 */
export async function defaultedSlots(layerRoot) {
  const tree = defaultsTree(layerRoot);
  const out = new Set();
  for (const rel of await walk(tree)) {
    for (const id of (await readFragments(join(tree, rel))).keys()) out.add(`${rel} ${id}`);
  }
  return out;
}

/**
 * The files a version composes into a project with these surfaces: every core file, less the ones gated
 * on a surface the project does not declare — the same selection `composeProject` makes. `upgrade`
 * needs it because compose writes and never deletes, so a file the old version composed and the new
 * one does not would otherwise outlive the move, and one a rolled-back move composed would outlive
 * the rollback — a loop gate still running on a pin that has none.
 *
 * @param {string} layerRoot - The release, or the working tree.
 * @param {string[]} surfaces - The project's surfaces.
 * @returns {Promise<Set<string>>} Paths relative to the project.
 */
export async function composedPaths(layerRoot, surfaces = []) {
  const coreTree = join(layerRoot, 'core', 'tree');
  const out = new Set();
  for (const rel of await walk(coreTree)) {
    const gate = REQUIRES.exec(await readFile(join(coreTree, rel), 'utf8'));
    if (gate && !surfaces.includes(gate[1])) continue;
    out.add(rel);
  }
  return out;
}

/**
 * Composes one project, and reports what it did.
 *
 * Separated from the CLI wrapper so tests can assert on the result rather than parse
 * printed text. The harness lost its oracle when projects started pinning a release —
 * there is no longer a live tree to diff against — so the checks this returns are what
 * stands in its place.
 *
 * @param {string} target - The project directory.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @param {{check?: boolean}} [options] - `check` compares without writing.
 * @returns {Promise<{error?: string, written: string[], differ: string[], unfilled: string[], skipped: string[]}>}
 */
export async function composeProject(target, ctx, options = {}) {
  const check = options.check === true;
  const written = [];
  const differ = [];
  const skipped = [];

  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    return { error: `no .nina/profile.json under ${target}${legacyHint(target)}`, written, differ, unfilled: [], skipped };
  }
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));
  const surfaces = profile.surfaces ?? [];

  const resolved = layerRootFor(ctx.root, profile.core);
  if (resolved.error) return { error: resolved.error, written, differ, unfilled: [], skipped };
  const layerRoot = resolved.dir;
  const defaults = defaultVocabulary(layerRoot);

  const coreTree = join(layerRoot, 'core', 'tree');
  const layers = [
    ...surfaces.map((s) => join(layerRoot, 'surfaces', s, 'tree')),
    defaultsTree(layerRoot),
    join(target, HARNESS, 'project', 'tree'),
  ];

  /** Layers whose fragments are expected to exist: the declared surfaces, plus the project's own. */
  const declared = new Set([...surfaces, 'project']);

  /** Slots the core expects a declared layer to fill, and no layer did. */
  const unfilled = [];
  /** Files a `nina:why` marker composed into, unclosed. */
  const malformed = [];

  for (const rel of (await walk(coreTree)).sort()) {
    let core = await readFile(join(coreTree, rel), 'utf8');
    const dest = join(target, rel);

    const requires = REQUIRES.exec(core);
    if (requires) {
      core = core.slice(requires[0].length);
      if (!surfaces.includes(requires[1])) {
        // The project has no such surface, so the file does not exist for it.
        skipped.push(rel);
        if (check && existsSync(dest)) differ.push(`${rel} (present, but no '${requires[1]}' surface)`);
        continue;
      }
    }

    // History is stripped from each piece before the pieces are joined. Joined first, an opener left
    // unclosed in one layer paired with the closer of a passage in another, and everything between them
    // — the core's own rules included — was stripped without a word.
    core = stripWhy(core);

    /** Fragments for this file: surfaces in declared order, project layer last (it wins). */
    const fragments = new Map();
    for (const layer of layers) {
      for (const [slot, text] of await readFragments(join(layer, rel))) fragments.set(slot, text);
    }

    const out = [];
    /** The holes the core leaves for this project, named so the notice can route to them. */
    const projectSlot = [];
    for (const line of core.split('\n')) {
      const marker = SLOT.exec(line);
      if (!marker) {
        // A slot can also sit at the end of a line, for what a surface ADDS to a line rather than
        // a line it supplies whole. The one that needed it is a frontmatter `tools:` list: the
        // reviewer's lived entirely in the frontend surface, so every profile without a frontend
        // composed a reviewer with no allowlist at all — every tool, Edit included. Moved into core
        // it granted browser tools to projects with no browser. Inline, the core owns the base list
        // and the surface appends to it.
        out.push(
          line.includes('<!-- nina:slot ')
            ? line.replace(INLINE_SLOT, (_, id) => {
                if (fragments.has(id)) return fragments.get(id).trim().replace(/\s*\n\s*/g, ' ');
                if (declared.has(id.split('.')[0])) unfilled.push(`${rel} ${id}`);
                return '';
              })
            : line,
        );
        continue;
      }
      if (marker[1].startsWith('project.')) projectSlot.push([marker[1], marker[2]].filter(Boolean).join(' '));
      // A slot whose surface this project does not declare simply disappears. One whose
      // surface IS declared and has no fragment is a hole nobody asked for — the core
      // expects text there. Left silent it composes a file with a gap in the middle of a
      // rule, which reads like an editing accident rather than a missing layer.
      if (fragments.has(marker[1])) {
        out.push(fragments.get(marker[1]));
      } else if (declared.has(marker[1].split('.')[0])) {
        unfilled.push(`${rel} ${marker[1]}`);
      }
    }
    // How a rule came to be — the history of the project it was learned in — is for whoever maintains the
    // harness. It stays in the layers, marked `nina:why`, and every dispatch in a project stops paying
    // for it: the rule, and the reason that generalizes, are what an agent acts on. Each piece was
    // stripped on its own above; a marker still here was left unclosed, and is said, like a hole.
    let text = out.join('\n');
    if (text.includes('nina:why')) malformed.push(rel);
    for (const [name, value] of Object.entries(profile.vocabulary ?? {})) {
      // `null` means "declared but not filled in yet" — leave the placeholder standing so
      // it is reported, rather than composing the rule with a hole where a noun should be.
      if (value === null || value === undefined) continue;
      text = text.split(`{{${name}}}`).join(value);
    }
    // What the project did not declare, the release may: a default fills only a name the profile
    // does not mention at all, so declaring one — even as null, "not filled yet" — takes it over.
    for (const [name, value] of Object.entries(defaults)) {
      if (name in (profile.vocabulary ?? {})) continue;
      text = text.split(`{{${name}}}`).join(value);
    }

    // Only what has a comment syntax the notice knows. A layer that one day composes JSON
    // would be corrupted by it rather than marked, so it gets nothing and says nothing.
    if (rel.endsWith('.md') || SCRIPT.test(rel)) text = stamp(text, rel, projectSlot);

    const previous = existsSync(dest) ? await readFile(dest, 'utf8') : null;
    if (check) {
      if (previous !== text) differ.push(rel);
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, text);
    written.push(rel);
    if (previous !== null && previous !== text) differ.push(rel);
  }

  return { written, differ, unfilled, skipped, malformed };
}

/**
 * `nina compose` — the CLI wrapper around {@link composeProject}.
 *
 * @param {string[]} argv - Command arguments; `--project <dir>` selects the target.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function compose(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  const check = argv.includes('--check');
  const result = await composeProject(target, ctx, { check });

  if (result.error) {
    console.error(result.error);
    return 1;
  }

  for (const rel of result.differ) {
    console.log(`  ${rel}: composed output differs from what is on disk`);
  }
  // A slot the caller already knows about is work still owed, not a hole nobody asked for.
  // It is still a hole in the composed text, and still printed — it just does not fail a
  // move that only reports it because it created it.
  const expected = expectedUnfilled(argv);
  // `--drift`: only whether the files on disk are what the layers compose. An unfilled slot is a fact
  // about the declaration, and the project's `declaration` detector — `nina check` — says it, with
  // where to fill it from. Both saying it put the same finding in front of the model twice, the second
  // time as 57 lines under a hint about hand edits that was wrong for a project not yet filled in.
  const driftOnly = argv.includes('--drift');
  // A surface's own slot left empty is a bug in the harness, not the project's to fill, so drift mode
  // still reports it; only the project's slots are left to the declaration detector.
  const reported = driftOnly ? result.unfilled.filter((slot) => !/ project\.\d+$/.test(slot)) : result.unfilled;
  const owed = reported.filter((slot) => !expected.has(slot));
  const awaited = reported.filter((slot) => expected.has(slot));
  if (owed.length > 0) {
    console.log(`  ${owed.length} slot(s) have no fragment in a declared layer:`);
    for (const slot of owed.slice(0, 12)) console.log(`    ${slot}`);
    if (owed.length > 12) console.log(`    … and ${owed.length - 12} more`);
  }
  for (const slot of awaited) console.log(`  ${slot} is new in this core and still to fill`);
  for (const rel of result.malformed) console.log(`  ✗ ${rel}: a nina:why marker is unclosed, and its text was composed`);

  if (check) {
    const bad = result.differ.length + owed.length + result.malformed.length;
    // The summary line stays exactly `compose: current`, which is what every project's drift
    // detector matches on to stay silent. Widening it here would make each of them speak.
    console.log(
      bad === 0
        ? 'compose: current'
        : driftOnly
          ? `compose: ${result.differ.length} file(s) differ`
          : `compose: ${result.differ.length} file(s) differ, ${owed.length} slot(s) unfilled`,
    );
    return bad === 0 ? 0 : 1;
  }
  console.log(`composed ${result.written.length} file(s) → ${relative(process.cwd(), target) || '.'}`);
  // The one place a pointer to `nina where` costs nothing. Put it in the notice instead and
  // every composed file in every project differs until it recomposes — for a pointer, not a
  // fix. This line is written to no file, so it can say what it likes, and it reaches whoever
  // just composed at the moment they are about to work on the result.
  console.log('  which layer owns a file? `nina where <path>` — the notice in each file says it too');
  return 0;
}
