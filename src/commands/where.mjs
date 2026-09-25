/**
 * `nina where` — says which layer owns a path, and therefore where a change to it belongs.
 *
 * The composed tree does not carry its own provenance: `nina:slot` and `nina:requires` are
 * consumed at composition, so a line in a project's `.claude/agents/qa.md` cannot say whether
 * it came from the core or from one of six surfaces. The `nina:generated` notice answers the
 * question for a file that exists and is about to be edited, which is the common case and the
 * one it should keep. This command exists for the three it cannot reach: a path that is not
 * composed yet, a path gated on a surface the project does not declare, and the line between
 * "a file this project owns outright" and "a file that has nothing to do with the harness" —
 * where no notice exists on either side, because neither is composed.
 *
 * Every answer is computed from the same helpers the other commands use: the slot sets come
 * from `check`, the layer root and the notice from `compose`, the role gates from `pills`. The
 * notice in particular is printed by calling `generatedNotice`, not by restating it — this
 * repo has already shipped one bug from two copies of the same fact drifting apart, and a
 * command whose whole purpose is to be trusted about where things go is the worst place for
 * a second one.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HARNESS, legacyHint } from '../paths.mjs';
import { REQUIRES, SLOT, defaultedSlots, generatedNotice, layerRootFor } from './compose.mjs';
import { filledSlots, owedDocuments } from './check.mjs';
import { roleGates } from './pills.mjs';

/** Slots read by number, the way the notice prints them. */
const byNumber = (a, b) => Number(/\.(\d+)/.exec(a)?.[1] ?? 0) - Number(/\.(\d+)/.exec(b)?.[1] ?? 0);

/**
 * The path as the layers spell it, so a match works the same on Windows.
 *
 * @param {string} rel - A path relative to the project root.
 * @returns {string}
 */
const posix = (rel) => rel.split(sep).join('/');

/**
 * Prints a block of text indented under the heading, one line at a time.
 *
 * @param {string} text - The block.
 */
function block(text) {
  for (const line of text.split('\n')) console.log(`  ${line}`);
}

/**
 * Says where a path's text comes from and where a change to it goes.
 *
 * @param {string[]} argv - `<path> [--project <dir>]`.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} 0 for any classification, 1 for a broken environment, 2 for usage.
 */
export async function where(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  // A positional argument, skipping whatever `--project` consumed.
  const consumed = new Set(argv.flatMap((a, i) => (a === '--project' ? [i + 1] : [])));
  const asked = argv.find((a, i) => !a.startsWith('--') && !consumed.has(i));
  if (!asked) {
    console.error('  usage: nina where <path> [--project <dir>]\n');
    return 2;
  }

  // The only command that takes a second path, nested inside the first. Every other one
  // trusts `--project` as the whole target, so this guard has nowhere else it could live.
  const rel = relative(target, resolve(target, asked));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    console.error(`  ${asked} is outside ${target} — nina where only classifies paths inside the project\n`);
    return 1;
  }

  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    console.error(`  no ${HARNESS}/profile.json under ${target}${legacyHint(target)}\n`);
    return 1;
  }
  let profile;
  try {
    profile = JSON.parse(await readFile(profilePath, 'utf8'));
  } catch (error) {
    console.error(`  ${profilePath} is not valid JSON — ${error.message}\n`);
    return 1;
  }

  const resolved = layerRootFor(ctx.root, profile.core);
  if (resolved.error) {
    console.error(`  ${resolved.error}\n`);
    return 1;
  }
  const available = (await readdir(join(resolved.dir, 'surfaces'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const surfaces = (profile.surfaces ?? []).filter((s) => available.includes(s));

  console.log(`  ${posix(rel)}\n`);

  const corePath = join(resolved.dir, 'core', 'tree', rel);
  if (existsSync(corePath)) {
    const core = await readFile(corePath, 'utf8');
    const gate = REQUIRES.exec(core)?.[1] ?? null;
    if (gate && !surfaces.includes(gate)) {
      block(`defined in core ${profile.core}, but gated on the "${gate}" surface, which this project
does not declare — so it is never composed here and is not on disk.
to get it: add "${gate}" to ${HARNESS}/profile.json and run \`nina compose\`.`);
      console.log(`\nwhere: gated (needs ${gate})\n`);
      return 0;
    }

    const mine = [];
    const from = new Set();
    for (const line of core.split('\n')) {
      const marker = SLOT.exec(line);
      if (!marker) continue;
      const surface = marker[1].split('.')[0];
      if (surface === 'project') mine.push([marker[1], marker[2]].filter(Boolean).join(' '));
      else if (surfaces.includes(surface)) from.add(surface);
    }
    mine.sort(byNumber);

    const filled = await filledSlots(target);
    const defaulted = await defaultedSlots(resolved.dir);
    const own = (slot) => filled.has(`${rel} ${slot.split(' ')[0]}`);
    // A slot the release writes itself until the project does is not open: it composes as written there.
    const fromRelease = mine.filter((slot) => !own(slot) && defaulted.has(`${rel} ${slot.split(' ')[0]}`));
    const open = mine.filter((slot) => !own(slot) && !fromRelease.includes(slot));
    block(`generated — from core ${profile.core}${from.size > 0 ? `, with fragments from ${[...from].sort().join(', ')}` : ''}`);
    if (mine.length === 0) {
      block('no project slot — every line of it comes from the harness');
    } else {
      block(`${mine.length} project slot(s), ${mine.length - open.length - fromRelease.length} filled${fromRelease.length > 0 ? `, ${fromRelease.length} with the release's text until the project writes its own` : ''}:`);
      for (const slot of mine) {
        const isOpen = open.includes(slot);
        const released = fromRelease.includes(slot);
        console.log(`    ${isOpen ? '○' : released ? '◐' : '●'} ${slot}${isOpen ? '  ← open' : released ? "  ← the release's text; write one to tailor it" : ''}`);
      }
    }
    console.log('');
    block(generatedNotice(rel, mine));
    console.log(`\nwhere: generated (${mine.length === 0 ? 'no project slot' : `${open.length} of ${mine.length} slot(s) open`})\n`);
    return 0;
  }

  // Not in the core, so nothing composes it. The rest is about telling a file this project
  // owns from a file the harness has never heard of — the distinction no notice can make,
  // because neither kind carries one.
  const owed = await owedDocuments(resolved.dir, surfaces);
  if (owed.has(posix(rel))) {
    block(`yours — the chosen layers reference it ${owed.get(posix(rel))} time(s) and no layer supplies it.
nothing composes this file; write it directly, and keep writing it.`);
    console.log('\nwhere: owned by the project (a document the harness reads but never writes)\n');
    return 0;
  }

  const pill = /^\.claude\/pills\/([^/]+)\/(.+)\.md$/.exec(posix(rel));
  if (pill) {
    const gates = await roleGates(resolved.dir);
    const role = pill[1];
    const known = role === 'shared' || gates.has(role);
    block(`yours — a pill, under the \`.claude/pills/<role>/\` convention \`.claude/pills/README.md\` defines.
${known ? `"${role}" is a role this project composes.` : `"${role}" is not a role core ${profile.core} composes — check the directory name.`}
nothing composes pill files; the pipeline writes them on a loop-back. \`nina pills\` checks the format.`);
    console.log(`\nwhere: owned by the project (pill${known ? '' : ', unknown role'})\n`);
    return 0;
  }

  const integration = /^\.claude\/integrations\/(.+)\.md$/.exec(posix(rel));
  if (integration) {
    const declared = (profile.integrations ?? []).some((e) => e?.slug === integration[1]);
    block(`yours — an integration doc. The layers reference \`.claude/integrations/<slug>.md\` generically;
this project's own slugs fill it.
${declared ? `"${integration[1]}" is declared in ${HARNESS}/profile.json.` : `"${integration[1]}" is NOT declared in ${HARNESS}/profile.json — declare it, or \`nina check\` will not know it exists.`}`);
    console.log(`\nwhere: owned by the project (integration doc${declared ? '' : ', undeclared'})\n`);
    return 0;
  }

  if (posix(rel).startsWith('.claude/plans/')) {
    block(`yours — work in progress. Nothing composes anything under \`.claude/plans/\`.`);
    console.log('\nwhere: owned by the project (plan)\n');
    return 0;
  }

  // A role is a core file. Composing one from the project layer is not possible, and this is
  // the one place a wrong guess creates a file that looks dispatchable and is not.
  if (/^\.claude\/agents\/.+\.md$/.test(posix(rel))) {
    block(`not composed — core ${profile.core} has no agent by this name, and a project cannot add one.
a new role is a change to the core (or to a surface) upstream: every project's pipeline is
the same pipeline, which is the point of composing it.`);
    console.log('\nwhere: not harness (a new role is an upstream change)\n');
    return 0;
  }

  block(
    existsSync(join(target, rel))
      ? `not harness — no layer of core ${profile.core} or its surfaces defines, gates or references
this path, and it is not one of the places the project owns by convention. It is your file;
nina has nothing to say about it.`
      : `not harness — nothing at this path in core ${profile.core}, in its surfaces, or on disk.`,
  );
  console.log('\nwhere: not harness\n');
  return 0;
}
