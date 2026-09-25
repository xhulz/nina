/**
 * Whether every agent spec can actually do what it says: its `tools:` allowlist against what its
 * body asks for, and every skill it names against what is installed.
 *
 * Written first in a consuming project, as its own detector, after a stage was twice instructed to
 * do something the runtime never gave it the means to do: `Skill` was absent from all nine `tools:`
 * lists while the specs made skills mandatory — 2 invocations in 743 runs — and devops was told to
 * invoke Playwright through `Skill` when Playwright is an MCP server and no such skill exists.
 * Neither surfaces on its own: the rule stays written, the agent reports success, and only a count
 * over transcripts shows the zero. It lives here now so every project gets it, the same move that
 * took the detector runner out of each project and into the package.
 *
 * Deliberately conservative. Skill and the browser tools are the two that actually went wrong and
 * both are unambiguous; Bash is not inferred, because specs quote commands meant for other stages.
 * A check that cries wolf gets ignored, which is the failure it exists to prevent.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * A skill id carries a `-` or a `:`. Skills sections quote CLI words in backticks too — `validate`,
 * `wrangler` — and every installed skill id is hyphenated or namespaced, so requiring one removes
 * that whole class of false positive for nothing.
 */
const SKILL_ID = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;

/**
 * Every skill installed for a project, by the id an agent would invoke: user skills by name,
 * plugin skills as `<plugin>:<name>`, and the project's own.
 *
 * @param {string} target - The project directory.
 * @returns {Promise<Set<string>>}
 */
export async function installedSkills(target) {
  const found = new Set();
  const user = join(homedir(), '.claude', 'skills');
  for (const e of await readdir(user, { withFileTypes: true }).catch(() => [])) {
    if (existsSync(join(user, e.name, 'SKILL.md'))) found.add(e.name);
  }
  const cache = join(homedir(), '.claude', 'plugins', 'cache');
  for (const market of await readdir(cache, { withFileTypes: true }).catch(() => [])) {
    if (!market.isDirectory()) continue;
    for (const plugin of await readdir(join(cache, market.name), { withFileTypes: true }).catch(() => [])) {
      if (!plugin.isDirectory()) continue;
      const pluginDir = join(cache, market.name, plugin.name);
      for (const version of await readdir(pluginDir, { withFileTypes: true }).catch(() => [])) {
        for (const skill of await readdir(join(pluginDir, version.name, 'skills'), { withFileTypes: true }).catch(() => [])) {
          if (skill.isDirectory()) found.add(`${plugin.name}:${skill.name}`);
        }
      }
    }
  }
  const own = join(target, '.claude', 'skills');
  for (const e of await readdir(own, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) found.add(e.name);
  }
  return found;
}

/**
 * The tools a spec's frontmatter grants.
 *
 * @param {string} spec - A composed agent spec.
 * @returns {string[]}
 */
export function granted(spec) {
  const line = /^tools:\s*(.+)$/m.exec(spec);
  return line ? line[1].split(',').map((t) => t.trim()).filter(Boolean) : [];
}

/**
 * What a spec's body requires, and which skills it names.
 *
 * @param {string} spec - A composed agent spec.
 * @returns {{needs: Set<string>, skills: Set<string>}}
 */
export function required(spec) {
  const needs = new Set();
  const skills = new Set();
  const start = spec.indexOf('## Skills you MUST consult');
  if (start !== -1) {
    const rest = spec.slice(start + 3);
    const end = rest.indexOf('\n## ');
    const section = end === -1 ? rest : rest.slice(0, end);
    // A skill is named where the section lists one: in bold, or as the first cell of a table row. Any
    // other name in backticks is prose — in some roles the project's own introduction composes inside
    // this section, and a region it named, `us-east-1`, was reported as a skill that is not installed.
    for (const line of section.split('\n')) {
      const listed = [
        ...[...line.matchAll(/\*\*`([^`]+)`\*\*/g)].map((m) => m[1]),
        ...(/^\|\s*`([^`]+)`\s*\|/.exec(line)?.slice(1) ?? []),
      ];
      for (const token of listed) {
        if (SKILL_ID.test(token) && (token.includes('-') || token.includes(':'))) skills.add(token);
      }
    }
  }
  if (skills.size > 0 || /\bSkill\b tool|via the `Skill`/.test(spec)) needs.add('Skill');
  for (const [, tool] of spec.matchAll(/`?(browser_[a-z_]+)`?/g)) needs.add(`mcp__plugin_playwright_playwright__${tool}`);
  return { needs, skills };
}

/**
 * Every mismatch between what the specs ask for and what they are given.
 *
 * @param {Map<string, string>} specs - Role → composed spec text.
 * @param {Set<string>|null} installed - Installed skills, or null to skip that half — the grant
 *   check is a fact about the harness, the install check a fact about one machine.
 * @returns {string[]}
 */
export function toolFindings(specs, installed) {
  const out = [];
  for (const [role, spec] of [...specs].sort(([a], [b]) => a.localeCompare(b))) {
    const has = granted(spec);
    const { needs, skills } = required(spec);
    for (const need of needs) if (!has.includes(need)) out.push(`${role}: its spec needs \`${need}\`, and its tools: does not grant it`);
    if (installed) for (const s of skills) if (!installed.has(s)) out.push(`${role}: names skill \`${s}\`, which is not installed`);
  }
  return out;
}

/** What each frontmatter key a spec must carry does, said when it is missing. */
const REQUIRED_KEYS = {
  name: 'it cannot be dispatched by name',
  description: 'Claude Code does not load an agent without one, so the pipeline has no such stage, and nothing says so',
  tools: 'the agent inherits every tool the session has',
};

/**
 * Every spec whose frontmatter lacks what Claude Code needs to load it as it is meant to run. The
 * `description` was the silent one: seven roles left it to the project, every new project composed them
 * without it, and the main session simply had no reviewer, qa or secops to dispatch — the stages stayed
 * in the graph, and an agent improvised in their place ran none of their rules.
 *
 * @param {Map<string, string>} specs - Role → composed spec text.
 * @returns {string[]}
 */
export function frontmatterFindings(specs) {
  const out = [];
  for (const [role, spec] of [...specs].sort(([a], [b]) => a.localeCompare(b))) {
    if (!spec.startsWith('---\n')) {
      out.push(`${role}: does not open with frontmatter — Claude Code does not load it`);
      continue;
    }
    const front = spec.slice(4, spec.indexOf('\n---', 4));
    for (const [key, why] of Object.entries(REQUIRED_KEYS)) {
      if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(front)) out.push(`${role}: frontmatter has no \`${key}:\` — ${why}`);
    }
  }
  return out;
}

/** The model values a spec may declare: an alias Claude Code knows, `inherit`, or a full model id. */
const MODEL_VALUE = /^(opus|sonnet|haiku|fable|inherit|claude-[a-z0-9.-]+(\[[a-z0-9]+\])?)$/;

/**
 * Every spec whose `model:` is none of those. The model is a stage's largest cost decision, and
 * `nina stats` reads it back against what ran; a typo there is a stage on a model nobody chose.
 *
 * @param {Map<string, string>} specs - Role → composed spec text.
 * @returns {string[]}
 */
export function modelFindings(specs) {
  const out = [];
  for (const [role, spec] of [...specs].sort(([a], [b]) => a.localeCompare(b))) {
    const front = spec.startsWith('---\n') ? spec.slice(4, spec.indexOf('\n---', 4)) : '';
    const model = /^model:[ \t]*(.*)$/m.exec(front)?.[1].trim();
    if (model !== undefined && !MODEL_VALUE.test(model)) {
      out.push(`${role}: \`model: ${model}\` is neither an alias (opus, sonnet, haiku, fable, inherit) nor a model id`);
    }
  }
  return out;
}
