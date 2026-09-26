/**
 * The project slots, and vocabulary names, a caller has declared it already knows are open.
 *
 * `nina upgrade --apply` creates slots: a new core can introduce one, and it cannot be filled
 * before the core that introduces it is pinned. A name only the new core uses is the same case,
 * named as `{{NAME}}`: `check` rolled a move back for one the preview had just listed as needed. Every reporter that fails on an unfilled slot
 * therefore has to be told, or the move deadlocks — there is no order in which it completes.
 *
 * Two reporters say this same thing, and the first fix taught only one: `check` counts a slot
 * with no fragment as a problem, and `compose --check` counts it as drift. The second is
 * reached through the project's own `harness:check` npm script, so the upgrade cannot pass it
 * an argument — which is why the environment carries it, and why both read it from here rather
 * than parsing their own. A third reporter added later gets this for free by calling this.
 *
 * The exemption is only ever as wide as what was named, and it does not persist: a plain
 * `nina check` or `pnpm harness:check`, run without it, still reports every open slot.
 */

/** The environment variable, which is how the answer reaches a command spawned by a script. */
export const EXPECT_ENV = 'NINA_EXPECT_UNFILLED';

/**
 * @param {string[]} argv - The command's arguments; `--expect-unfilled <a,b>` names slots.
 * @param {NodeJS.ProcessEnv} [env] - Where to read `NINA_EXPECT_UNFILLED` from.
 * @returns {Set<string>} Slot ids as `<relative path> <slot id>`, names as `{{NAME}}`.
 */
export function expectedUnfilled(argv = [], env = process.env) {
  const fromArgv = argv.includes('--expect-unfilled') ? argv[argv.indexOf('--expect-unfilled') + 1] ?? '' : '';
  return new Set(
    [fromArgv, env[EXPECT_ENV] ?? '']
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
