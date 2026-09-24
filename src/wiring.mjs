/**
 * What a project has to wire itself for its harness to run: the npm scripts the detectors hang off,
 * and the Claude Code hooks that run the composed scripts.
 *
 * None of it can live in a layer. NINA composes no `.claude/settings.json` and no `package.json` —
 * both belong to the project and carry far more than the harness — so for a long time a new project
 * got a composed `scripts/harness-check.mjs` and nothing that ever ran it. Spliter's wiring was typed
 * by hand, one piece per release, and the one piece that let the model see a finding at all arrived
 * last. Written once here, `init` writes it, `wire` merges it, `check` asks for it and `upgrade`
 * refuses to move without it — from the same list, because two copies of one fact drifting apart has
 * already shipped in this repository more than once.
 *
 * Each hook names the composed script it runs, and is only asked for once the pinned core ships that
 * script: a project is never told to wire something its version does not have.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The composed scripts the hooks run. */
export const CHECK = 'scripts/harness-check.mjs';
export const GATE = 'scripts/loop-gate.mjs';
export const GUARD = 'scripts/edit-guard.mjs';

/** The npm scripts the detectors hang off: the reviewer runs one, the other is a detector itself. */
export const SCRIPTS = {
  'harness:check': 'node scripts/harness-check.mjs',
  'harness:compose:check': 'nina compose --check --quiet',
};

/** What each npm script has to reach, whatever else its command does. */
const REACHES = { 'harness:check': 'scripts/harness-check.mjs', 'harness:compose:check': 'compose --check' };

/**
 * A hook command that runs a composed script, and stays inert where the script is not composed yet.
 *
 * With `crash`, a script that exists and cannot even start says so, as the hook's JSON answer. The
 * runner and the gate both exit 0 whatever they find, so a non-zero exit only ever means they did not
 * load — above all a project where `@xhulz/nina` was never installed, which used to fail every hook
 * without a word: no drift reported, no lesson owed, no loop cap held, and nothing saying so.
 */
const command = (script, mode, crash) => {
  const run = `node "$f"${mode ? ` ${mode}` : ''}`;
  if (!crash) return `f="\${CLAUDE_PROJECT_DIR:-.}/${script}"; [ -f "$f" ] && ${run} || true`;
  const json = JSON.stringify(crash).replace(/'/g, '’');
  return `f="\${CLAUDE_PROJECT_DIR:-.}/${script}"; [ -f "$f" ] && { ${run} || printf '%s\\n' '${json}'; } || true`;
};

/**
 * Whether the composed scripts can load the package from this project — resolved the way Node resolves
 * their `import`, so a package hoisted to a workspace root counts, where a look in the project's own
 * `node_modules` said it was missing and every hook would fail.
 *
 * @param {string} target - The project directory.
 * @returns {boolean}
 */
export function packageInstalled(target) {
  try {
    createRequire(join(target, 'package.json')).resolve('@xhulz/nina/package.json');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the installed package exports a module the composed scripts import.
 *
 * @param {string} target - The project directory.
 * @param {string} module - `gate`, `guard`, …
 * @returns {boolean}
 */
export function packageExports(target, module) {
  try {
    createRequire(join(target, 'package.json')).resolve(`@xhulz/nina/${module}`);
    return true;
  } catch {
    return false;
  }
}

/** The command a hook ran before it could say its script did not start — what `wire` updates. */
const previousCommand = (h) => command(h.script, h.mode);

/** What a hook says when its script cannot start: the likeliest cause, and the one command that fixes it. */
const CANNOT_START = 'is @xhulz/nina installed in this project, and no older than the version .nina/profile.json pins? (pnpm add -D file:vendor/xhulz-nina-<version>.tgz)';

/**
 * Every hook a project's settings should carry, in the order a fresh settings file lists them. `why` is
 * the sentence `check` says when one is missing — what stops happening without it.
 *
 * The harness check has two: `Stop` tells the person what a turn left behind, `UserPromptSubmit` puts
 * the same findings in the model's context before it answers — the only one of the two it reads. The
 * loop gate has four, one per fact it keeps: a verdict, a dispatch, the owner speaking, and the
 * decision itself.
 */
export const HOOKS = [
  {
    event: 'Stop', script: CHECK, mode: '--hook', timeout: 30, statusMessage: 'Checking the harness...', why: 'nobody is told what a turn left behind',
    crash: { systemMessage: `NINA: the harness check could not start — ${CANNOT_START}` },
  },
  {
    event: 'UserPromptSubmit', script: CHECK, mode: '--context', timeout: 60, statusMessage: 'Checking the harness...', why: 'the model never sees a finding',
    crash: {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `The NINA harness check could not start in this project — ${CANNOT_START} Until it can, no drift, lesson or loop cap is checked: tell the user.`,
      },
    },
  },
  { event: 'UserPromptSubmit', script: GATE, timeout: 10, why: "the owner's reply never starts a loop's count over" },
  {
    event: 'PreToolUse', matcher: 'Agent|Task|SendMessage', script: GATE, timeout: 10, why: 'the caps in .claude/graph.md stay instructions nothing holds',
    crash: { systemMessage: `NINA: the loop gate could not start, so the caps in .claude/graph.md are not held — ${CANNOT_START}` },
  },
  { event: 'PostToolUse', matcher: 'Agent|Task|SendMessage|AskUserQuestion|SubagentHandback', script: GATE, timeout: 10, why: 'the gate never learns which rounds went out, or that the owner answered' },
  { event: 'SubagentStop', script: GATE, timeout: 10, why: 'the gate misses the verdict of a stage that wrote its report as its last message' },
  {
    event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit|NotebookEdit', script: GUARD, timeout: 10, why: 'a hand edit to a composed file is found only after the turn, as drift, and the next compose overwrites it',
    crash: { systemMessage: `NINA: the edit guard could not start, so composed files can be edited in place — ${CANNOT_START}` },
  },
];

/** Where a project's hooks can live: Claude Code reads both, so a hook kept in the local file counts. */
const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];

/** The scripts some hook runs — `check` asks for these by hook, not by npm script. */
export const HOOK_SCRIPTS = new Set(HOOKS.map((h) => h.script));

/**
 * The scripts a version composes into a project with these surfaces, as `scripts/<name>`.
 *
 * @param {string} layerRoot - The release, or the working tree.
 * @param {string[]} surfaces - The project's surfaces.
 * @returns {Promise<Set<string>>}
 */
export async function shippedScripts(layerRoot, surfaces = []) {
  const out = new Set();
  const dirs = [join(layerRoot, 'core', 'tree', 'scripts'), ...surfaces.map((s) => join(layerRoot, 'surfaces', s, 'tree', 'scripts'))];
  for (const dir of dirs) {
    for (const file of await readdir(dir).catch(() => [])) {
      if (/\.(mjs|cjs|js)$/.test(file)) out.add(`scripts/${file}`);
    }
  }
  return out;
}

/** The settings group for one hook. */
function group(h) {
  return {
    ...(h.matcher ? { matcher: h.matcher } : {}),
    hooks: [{ type: 'command', command: command(h.script, h.mode, h.crash), timeout: h.timeout, ...(h.statusMessage ? { statusMessage: h.statusMessage } : {}) }],
  };
}

/**
 * Whether a settings matcher reaches a tool, read the way Claude Code reads it: absent, empty or `*`
 * is every tool; a matcher of only letters, digits, `_` and `|` is a list of exact names; anything else
 * is an unanchored regular expression. So `Agent | Task` — with its spaces — reaches nothing, and
 * `(Agent|Task|SendMessage)` reaches all three.
 *
 * @param {unknown} matcher - A group's `matcher`.
 * @param {string} tool - A tool name.
 * @returns {boolean}
 */
export function matcherReaches(matcher, tool) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
  if (typeof matcher !== 'string') return false;
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) return matcher.split('|').includes(tool);
  try {
    return new RegExp(matcher).test(tool);
  } catch {
    return false;
  }
}

/**
 * The groups settings list for one event: `[]` when there are none, null when the shape is not one
 * Claude Code can run — reported, never thrown, because a crash here takes `check`, `wire`, `upgrade`
 * and the gate's selftest down with it.
 */
function groupsFor(hooks, event) {
  if (hooks === undefined || hooks === null) return [];
  if (typeof hooks !== 'object' || Array.isArray(hooks)) return null;
  if (hooks[event] === undefined) return [];
  return Array.isArray(hooks[event]) ? hooks[event] : null;
}

/**
 * Whether settings already run a hook. Recognised by what the command runs, not by its exact text —
 * a project may have written its own — and by a matcher that reaches every tool the hook needs.
 */
function covered(hooks, h) {
  const groups = groupsFor(hooks, h.event) ?? [];
  const need = h.matcher ? h.matcher.split('|') : [];
  return groups.some((g) => {
    if (!g || typeof g !== 'object') return false;
    if (!need.every((tool) => matcherReaches(g.matcher, tool))) return false;
    return Array.isArray(g.hooks) && g.hooks.some((x) => {
      const cmd = String(x?.command ?? '');
      return cmd.includes(h.script) && (!h.mode || cmd.includes(h.mode));
    });
  });
}

/** The command settings run for a hook, when they run one — the selftest runs it the same way. */
export function hookCommand(settings, event, script) {
  for (const g of groupsFor(settings?.hooks, event) ?? []) {
    for (const x of Array.isArray(g?.hooks) ? g.hooks : []) {
      if (String(x?.command ?? '').includes(script)) return String(x.command);
    }
  }
  return null;
}

/**
 * The settings file a project starts with when it has none: every hook its version's scripts need.
 *
 * @param {Set<string>} [shipped] - The scripts the pinned version composes; every hook when omitted.
 * @returns {string}
 */
export function settingsFile(shipped = HOOK_SCRIPTS) {
  return `${JSON.stringify({ hooks: settingsHooks(HOOKS.filter((h) => shipped.has(h.script))) }, null, 2)}\n`;
}

/** Hooks as settings JSON, grouped by event. */
function settingsHooks(hooks) {
  const out = {};
  for (const h of hooks) (out[h.event] ??= []).push(group(h));
  return out;
}

/**
 * Whatever of the wiring a project lacks, one sentence each.
 *
 * @param {string} target - The project directory.
 * @param {Set<string>} shipped - The scripts the version in question composes.
 * @returns {Promise<string[]>}
 */
export async function missingWiring(target, shipped) {
  const out = [];
  // First, because nothing below matters without it: the composed scripts import the package.
  if ((shipped.has(CHECK) || shipped.has(GATE) || shipped.has(GUARD)) && !packageInstalled(target)) {
    out.push(
      '@xhulz/nina is not installed in this project, so the composed scripts cannot load and every hook fails — ' +
        'pnpm add -D file:vendor/xhulz-nina-<version>.tgz, with the .tgz `npm pack` makes in the NINA repo',
    );
  } else {
    // Installed, but older than the pin: a composed script imports a module the installed package does
    // not export, and its hook fails on every call — found when a linked checkout moved a project whose
    // vendored package was a release behind.
    for (const [script, module] of [[GATE, 'gate'], [GUARD, 'guard']]) {
      if (shipped.has(script) && !packageExports(target, module)) {
        out.push(
          `the installed @xhulz/nina has no ./${module}, so ${script} cannot load — it is older than the version .nina/profile.json pins; ` +
            'install the .tgz of that version',
        );
      }
    }
  }
  if (shipped.has(CHECK)) {
    const pkgPath = join(target, 'package.json');
    if (!existsSync(pkgPath)) {
      out.push('package.json does not exist, so no npm script can run the harness check');
    } else {
      let scripts = {};
      try {
        scripts = JSON.parse(await readFile(pkgPath, 'utf8')).scripts ?? {};
      } catch (error) {
        out.push(`package.json is not valid JSON — ${error.message}`);
      }
      for (const [name, cmd] of Object.entries(SCRIPTS)) {
        if (!scripts[name]) out.push(`package.json has no "${name}" script — add "${name}": "${cmd}"`);
        // The specs run these by name, so the name has to reach the thing it is named for.
        else if (!String(scripts[name]).includes(REACHES[name])) {
          out.push(`package.json's "${name}" runs \`${scripts[name]}\`, which does not reach ${REACHES[name]} — expected "${cmd}"`);
        }
      }
    }
  }
  const wanted = HOOKS.filter((h) => shipped.has(h.script));
  if (wanted.length === 0) return out;
  const merged = {};
  for (const rel of SETTINGS_FILES) {
    const path = join(target, rel);
    if (!existsSync(path)) continue;
    let settings;
    try {
      settings = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      out.push(`${rel} is not valid JSON — ${error.message}`);
      continue;
    }
    const shape = settings?.hooks;
    if (shape === undefined || shape === null) continue;
    if (typeof shape !== 'object' || Array.isArray(shape)) {
      out.push(`${rel} has a "hooks" that is not an object of event lists — no hook in it can run`);
      continue;
    }
    for (const [event, groups] of Object.entries(shape)) {
      if (Array.isArray(groups)) (merged[event] ??= []).push(...groups);
      else if (wanted.some((h) => h.event === event)) out.push(`${rel}'s hooks.${event} is not a list — no hook in it can run`);
    }
  }
  for (const h of wanted) {
    if (covered(merged, h)) continue;
    out.push(
      `.claude/settings.json has no ${h.event} hook${h.matcher ? ` for ${h.matcher}` : ''} running \`${h.script}${h.mode ? ` ${h.mode}` : ''}\` — without it ${h.why}`,
    );
  }
  return out;
}

/**
 * Hooks this project runs in the form they had before they could say their script did not start —
 * the exact command `init` or `wire` used to write, so nothing a person customised is ever touched.
 *
 * @param {string} target - The project directory.
 * @param {Set<string>} shipped - The scripts the version in question composes.
 * @returns {Promise<string[]>}
 */
export async function staleHooks(target, shipped) {
  let settings = null;
  try {
    settings = JSON.parse(await readFile(join(target, '.claude', 'settings.json'), 'utf8'));
  } catch {
    return [];
  }
  return HOOKS.filter((h) => h.crash && shipped.has(h.script)).filter((h) =>
    (groupsFor(settings?.hooks, h.event) ?? []).some((g) => (Array.isArray(g?.hooks) ? g.hooks : []).some((x) => x?.command === previousCommand(h))),
  ).map((h) => `${h.event} → ${h.script}${h.mode ? ` ${h.mode}` : ''}`);
}

/**
 * The hooks a project lacks, as the JSON to merge into its settings — what `wire` prints, and what
 * `upgrade` points at when it refuses to move without them.
 *
 * @param {string} target - The project directory.
 * @param {Set<string>} shipped - The scripts the version in question composes.
 * @returns {Promise<string|null>} Null when nothing is missing.
 */
export async function missingFragment(target, shipped) {
  let settings = null;
  try {
    settings = JSON.parse(await readFile(join(target, '.claude', 'settings.json'), 'utf8'));
  } catch {
    // Absent or unreadable: everything is missing, and `missingWiring` says which.
  }
  const lacking = HOOKS.filter((h) => shipped.has(h.script) && !covered(settings?.hooks, h));
  return lacking.length === 0 ? null : JSON.stringify({ hooks: settingsHooks(lacking) }, null, 2);
}

/**
 * Writes the wiring a project lacks: hook groups appended to `.claude/settings.json`, scripts added to
 * `package.json`. Nothing already there is changed, and an unreadable file is left alone and reported.
 *
 * @param {string} target - The project directory.
 * @param {Set<string>} shipped - The scripts the version in question composes.
 * @param {{settings?: boolean}} [options] - `settings: false` leaves the settings file untouched —
 *   `init` writes one only where there is none.
 * @returns {Promise<{done: string[], problems: string[]}>}
 */
export async function applyWiring(target, shipped, { settings: editSettings = true } = {}) {
  const done = [];
  const problems = [];

  const settingsPath = join(target, '.claude', 'settings.json');
  if (editSettings) {
    let settings = {};
    let indent = '  ';
    let readable = true;
    if (existsSync(settingsPath)) {
      try {
        const text = await readFile(settingsPath, 'utf8');
        settings = JSON.parse(text);
        indent = /^[ \t]+/m.exec(text)?.[0] ?? '  ';
      } catch (error) {
        readable = false;
        problems.push(`.claude/settings.json is not valid JSON, so nothing was merged into it — ${error.message}`);
      }
    }
    if (readable && (settings === null || typeof settings !== 'object' || Array.isArray(settings) || HOOKS.some((h) => groupsFor(settings.hooks, h.event) === null))) {
      readable = false;
      problems.push('.claude/settings.json has hooks in a shape Claude Code does not read, so nothing was merged into it — fix its "hooks" by hand');
    }
    if (readable) {
      const hooks = settings.hooks ?? {};
      const added = [];
      for (const h of HOOKS.filter((h) => shipped.has(h.script))) {
        if (covered(hooks, h)) continue;
        (hooks[h.event] ??= []).push(group(h));
        added.push(`${h.event}${h.matcher ? ` (${h.matcher})` : ''} → ${h.script}${h.mode ? ` ${h.mode}` : ''}`);
      }
      // An old command, exactly as it was written, learns to say when its script cannot start.
      for (const h of HOOKS.filter((h) => h.crash && shipped.has(h.script))) {
        for (const g of hooks[h.event] ?? []) {
          for (const x of Array.isArray(g?.hooks) ? g.hooks : []) {
            if (x?.command === previousCommand(h)) {
              x.command = command(h.script, h.mode, h.crash);
              added.push(`${h.event} → ${h.script}${h.mode ? ` ${h.mode}` : ''} (updated to say when it cannot start)`);
            }
          }
        }
      }
      if (added.length > 0) {
        settings.hooks = hooks;
        await mkdir(join(target, '.claude'), { recursive: true });
        await writeFile(settingsPath, `${JSON.stringify(settings, null, indent)}\n`);
        for (const a of added) done.push(`.claude/settings.json — ${a}`);
      }
    }
  }

  const pkgPath = join(target, 'package.json');
  if (shipped.has(CHECK) && existsSync(pkgPath)) {
    try {
      const text = await readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(text);
      const lacking = Object.keys(SCRIPTS).filter((name) => !pkg.scripts?.[name]);
      if (lacking.length > 0) {
        pkg.scripts = { ...(pkg.scripts ?? {}), ...Object.fromEntries(lacking.map((name) => [name, SCRIPTS[name]])) };
        const indent = /^[ \t]+/m.exec(text)?.[0] ?? '  ';
        await writeFile(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);
        done.push(`package.json — ${lacking.join(', ')}`);
      }
    } catch (error) {
      problems.push(`package.json is not valid JSON, so no script was added to it — ${error.message}`);
    }
  }
  return { done, problems };
}
