/**
 * `nina wire` — wires what a project's harness needs in order to run: its hooks and its npm scripts.
 *
 * `init` writes a settings file only where there is none, and `check` reports what is missing, which
 * left every project that already had settings with a JSON fragment to merge by hand each time a
 * release added a hook. This merges it: it appends the hook groups the settings lack and the scripts
 * `package.json` lacks, and changes nothing that is already there.
 *
 *   nina wire                  what the pinned version needs and the project lacks (writes nothing)
 *   nina wire --apply          merge it
 *   nina wire --to <v> ...     for a version about to be pinned — safe before the move, because every
 *                              hook runs its script only once that script is composed
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HARNESS, legacyHint } from '../paths.mjs';
import { applyWiring, missingFragment, missingWiring, shippedScripts, staleHooks } from '../wiring.mjs';
import { layerRootFor } from './compose.mjs';

/**
 * @param {string[]} argv - `[--project <dir>] [--to <version>] [--apply]`.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code: 0 when everything is wired.
 */
export async function wire(argv, ctx) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const target = resolve(arg('--project') ?? '.');
  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    console.error(`  no ${HARNESS}/profile.json under ${target}${legacyHint(target)}\n`);
    return 2;
  }
  let profile;
  try {
    profile = JSON.parse(await readFile(profilePath, 'utf8'));
  } catch (error) {
    console.error(`  ${profilePath} is not valid JSON — ${error.message}\n`);
    return 2;
  }
  const version = arg('--to') ?? profile.core;
  const resolved = layerRootFor(ctx.root, version);
  if (resolved.error) {
    console.error(`  ${resolved.error}\n`);
    return 2;
  }
  const available = (await readdir(join(resolved.dir, 'surfaces'), { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const shipped = await shippedScripts(resolved.dir, (profile.surfaces ?? []).filter((s) => available.includes(s)));

  const missing = await missingWiring(target, shipped);
  const stale = await staleHooks(target, shipped);
  if (missing.length === 0 && stale.length === 0) {
    console.log(`  everything core ${version} runs from hooks and npm scripts is wired`);
    console.log('wire: current');
    return 0;
  }

  if (!argv.includes('--apply')) {
    if (missing.length > 0) console.log(`  core ${version} needs, and this project does not have:\n`);
    for (const m of missing) console.log(`    ✗ ${m}`);
    if (stale.length > 0) {
      console.log(`\n  ${stale.length} hook(s) run the command as it was before it could say its script did not start:`);
      for (const s of stale) console.log(`    · ${s}`);
    }
    const fragment = await missingFragment(target, shipped);
    if (fragment) {
      console.log('\n  the hooks, as they would be merged into .claude/settings.json:\n');
      for (const line of fragment.split('\n')) console.log(`    ${line}`);
    }
    console.log(`\n  \`nina wire${arg('--to') ? ` --to ${version}` : ''} --apply\` merges them, changing nothing else — a customised command is never touched.`);
    if (missing.some((m) => m.startsWith('@xhulz/nina is not installed'))) {
      console.log('  The package it cannot install: that one is `pnpm add -D -E @xhulz/nina`.');
    }
    console.log(`wire: ${missing.length} missing${stale.length ? `, ${stale.length} to update` : ''}`);
    return 1;
  }

  const { done, problems } = await applyWiring(target, shipped);
  for (const d of done) console.log(`  wired ${d}`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  const left = await missingWiring(target, shipped);
  for (const l of left) console.log(`  ✗ still missing: ${l}`);
  console.log(left.length === 0 ? 'wire: current' : `wire: ${left.length} still missing`);
  return left.length === 0 ? 0 : 1;
}
