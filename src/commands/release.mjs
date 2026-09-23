/**
 * `nina release <version>` — freezes the working core and surfaces as an immutable release.
 *
 * A project pins a release in its `.nina/profile.json` (`"core": "0.1.0"`), so work on
 * the harness does not move the harness under a project that is busy shipping. Without
 * this, the first edit to `core/` makes every consuming project's composition detector
 * report drift on every turn — the same noise the detectors exist to remove.
 *
 * Releases are never rewritten. Fixing a release means cutting the next one.
 */

import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** A release name: dotted numbers, so the directory sorts and reads like a version. */
const VERSION = /^\d+\.\d+\.\d+$/;

/** The top-level `"version"` field, matched on its own line so the rest of the file is untouched. */
const PACKAGE_VERSION = /^(\s*"version":\s*)"[^"]*"/m;

/**
 * Moves the package's own version to the release being cut.
 *
 * The package ships `releases/`, so a package version below the newest release describes
 * nothing that is inside it: 0.5.1 shipped releases through 0.7.0 because two cuts went by
 * without a bump, and the banner announced the stale number the whole time. Cutting a
 * release is the one moment the compiler and the layers are known to agree, so the tool
 * writes it instead of asking to be remembered.
 *
 * The field is replaced in place rather than by re-serializing the parsed object. A
 * `JSON.stringify` round trip rewrites every line, and a release commit should show the one
 * that changed.
 *
 * @param {string} root - The NINA repo.
 * @param {string} version - The release being cut.
 * @returns {Promise<{from: string}|{skipped: string}>} What was replaced, or why nothing was.
 */
async function bumpPackage(root, version) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return { skipped: 'there is none here' };
  const text = await readFile(path, 'utf8');
  try {
    const from = JSON.parse(text).version;
    const next = text.replace(PACKAGE_VERSION, `$1"${version}"`);
    // Anchoring on a line is a guess about the file's shape; parsing the result back is the
    // check. A replacement that hit a nested `version` leaves the top-level one untouched,
    // and would otherwise be reported as a bump that never happened.
    if (JSON.parse(next).version !== version) return { skipped: 'its top-level version field was not found' };
    await writeFile(path, next);
    return { from };
  } catch {
    return { skipped: 'it does not parse' };
  }
}

/**
 * Cuts a release.
 *
 * @param {string[]} argv - Command arguments; the first is the version.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function release(argv, ctx) {
  const version = argv.find((a) => !a.startsWith('--'));
  if (!version || !VERSION.test(version)) {
    console.error('  usage: nina release <major.minor.patch>\n');
    return 2;
  }

  // A release is cut FROM the working tree, so it is a repo operation. An installed package
  // has no working tree and its own directory is not a place to write.
  if (!existsSync(join(ctx.root, 'core'))) {
    console.error(`  ${ctx.root} has no working core to freeze — cut a release from a checkout of the NINA repo.\n`);
    return 1;
  }

  const dest = join(ctx.root, 'releases', version);
  if (existsSync(dest)) {
    console.error(`  ${version} already exists — a release is immutable; cut the next one.\n`);
    return 1;
  }

  await mkdir(dest, { recursive: true });
  for (const layer of ['core', 'surfaces']) {
    await cp(join(ctx.root, layer), join(dest, layer), { recursive: true });
  }

  const surfaces = (await readdir(join(dest, 'surfaces'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const bumped = await bumpPackage(ctx.root, version);

  console.log(`  released ${version} — core + ${surfaces.length} surfaces (${surfaces.join(', ')})`);
  if (bumped.skipped) {
    console.log(`  package.json not updated — ${bumped.skipped}; the banner will understate this release`);
  } else if (bumped.from !== version) {
    console.log(`  package.json ${bumped.from} → ${version}`);
  }
  console.log(`  a project pins it with "core": "${version}" in .nina/profile.json\n`);
  return 0;
}
