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
 * A vocabulary name: capitals, digits and `_`, from a letter — `{{S3_BUCKET}}` as much as `{{OWNER}}`. Every
 * reader of a placeholder reads it with this one grammar. Compose took any name the profile declared while
 * `check`, `init` and `upgrade` looked only for capitals and `_`, so `{{S3_BUCKET}}` was reported as declared
 * and referenced by nothing, and deleting it on that advice composed the placeholder raw, with nobody saying so.
 */
export const NAME = /^[A-Z][A-Z0-9_]*$/;

/** A placeholder in a text, its name captured. */
export const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** A name a tier may move: a stage's model or its effort, never a command, a path or a limit. */
const TIERED = /_(?:MODEL|EFFORT)$/;

/**
 * Names that took over stages from another, the new name → the one those stages read before. A project that
 * declared the old name had them on its value; after the move they read the new one, at the release's default
 * until it is declared too, and `upgrade` says so rather than move them in silence.
 */
export const TOOK_OVER = { ARCHITECT_MODEL: 'DEEP_MODEL', IMMUTABLE_MODEL: 'DEEP_MODEL', IMMUTABLE_EFFORT: 'DEEP_EFFORT' };

/**
 * The defaults a layer root supplies, name → value. Anything that is not a string under an
 * upper-case name is ignored rather than trusted: a default reaches every project that pins it.
 *
 * With a tier, that tier's models and efforts replace the release's own, so every reader of a
 * default — compose, check, init, upgrade — reads the one the project composes. A tier the release
 * does not have moves nothing here; {@link tierProblem} is what says so.
 *
 * @param {string} layerRoot - A release directory, or the working tree.
 * @param {string} [tier] - The profile's `tier`, when it declares one.
 * @returns {Record<string, string>}
 */
export function defaultVocabulary(layerRoot, tier) {
  let defaults = {};
  try {
    const parsed = JSON.parse(readFileSync(join(layerRoot, 'core', 'vocabulary.json'), 'utf8'));
    defaults = Object.fromEntries(Object.entries(parsed).filter(([name, value]) => NAME.test(name) && typeof value === 'string'));
  } catch {
    return {};
  }
  const levels = tiers(layerRoot);
  return tier !== undefined && Object.hasOwn(levels, tier) ? { ...defaults, ...levels[tier] } : defaults;
}

/**
 * The tiers a layer root supplies, level → the models and efforts it moves, from `core/tiers.json`.
 *
 * A tier is a named set of the defaults that decide what each stage runs on, so a project picks how
 * much its pipeline spends in one word rather than five vocabulary values. Only a `_MODEL` or an
 * `_EFFORT` name is taken: a tier that moved a command or a limit would change what a stage does, not
 * what it runs on. A release from before tiers has none.
 *
 * @param {string} layerRoot - A release directory, or the working tree.
 * @returns {Record<string, Record<string, string>>}
 */
export function tiers(layerRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(layerRoot, 'core', 'tiers.json'), 'utf8'));
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, moves]) => moves !== null && typeof moves === 'object' && !Array.isArray(moves))
        .map(([level, moves]) => [level, Object.fromEntries(Object.entries(moves).filter(([name, value]) => NAME.test(name) && TIERED.test(name) && typeof value === 'string'))]),
    );
  } catch {
    return {};
  }
}

/**
 * Why a tier cannot compose against a release, or null when it can — or when none is declared.
 *
 * @param {string} layerRoot - A release directory, or the working tree.
 * @param {unknown} tier - The profile's `tier`, as written.
 * @param {string} [release] - The release's name, for the message.
 * @returns {string|null}
 */
export function tierProblem(layerRoot, tier, release = 'this release') {
  if (tier === undefined) return null;
  const levels = Object.keys(tiers(layerRoot));
  if (levels.length === 0) return `tier "${tier}": ${release} has no tiers — they came in 0.81.0`;
  if (typeof tier !== 'string' || !levels.includes(tier)) return `tier "${tier}" is not one ${release} has: ${levels.join(', ')}`;
  return null;
}

/**
 * What each kind of stage runs on, in one line, from the values a project composes with: the architect, the
 * stages that judge (the reviewers, the design-reviewer, secops, devops), and the stages that carry a spec out.
 * A release from before the architect had a model of its own gave it the judges'.
 *
 * @param {Record<string, string>} values - The project's vocabulary over its release's defaults.
 * @returns {string}
 */
export function modelsLine(values) {
  const at = (model, effort) => `${model ?? '?'} at ${effort ?? '?'}`;
  return (
    `architect ${at(values.ARCHITECT_MODEL ?? values.DEEP_MODEL, values.ARCHITECT_EFFORT)} · ` +
    `reviewers ${at(values.DEEP_MODEL, values.DEEP_EFFORT)} · builders ${at(values.WORK_MODEL, values.WORK_EFFORT)}`
  );
}
