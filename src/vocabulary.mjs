/**
 * The vocabulary a release supplies itself.
 *
 * Every `{{PLACEHOLDER}}` a layer references used to be owed by the project, so a rule could only
 * name a thing generically if every project then declared it. That kept the stack's own commands
 * written out in the core — `pnpm typecheck` in eight places — because making them placeholders
 * would have asked each project, on its next upgrade, for four answers that were the same in all of
 * them. A default is the release's answer: the project declares a name only to change it, and a
 * project on another stack changes four lines instead of a core it cannot edit.
 *
 * The defaults live in `core/vocabulary.json`, so a release freezes them with its layers and a
 * pinned project composes the same text whatever the working tree says. A release that has no such
 * file supplies nothing, which is exactly how every release before it behaved.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The defaults a layer root supplies, name → value. Anything that is not a string under an
 * upper-case name is ignored rather than trusted: a default reaches every project that pins it.
 *
 * @param {string} layerRoot - A release directory, or the working tree.
 * @returns {Record<string, string>}
 */
export function defaultVocabulary(layerRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(layerRoot, 'core', 'vocabulary.json'), 'utf8'));
    return Object.fromEntries(Object.entries(parsed).filter(([name, value]) => /^[A-Z_]+$/.test(name) && typeof value === 'string'));
  } catch {
    return {};
  }
}
