#!/usr/bin/env node
/**
 * Checks that every agent spec can actually do what it says.
 *
 * Twice in two days a stage was instructed to do something the runtime never gave it
 * the means to do: `Skill` was absent from all nine `tools:` lists while the docs made
 * skills mandatory (2 invocations in 743 runs), and devops was told to invoke
 * `playwright` via Skill when Playwright is an MCP server and no such skill exists.
 * Neither would ever surface on its own — the rule stays written, the agent reports
 * success, and only a measurement over transcripts shows the zero.
 *
 * The `tools:` field is an allowlist. This compares it against what the spec body asks
 * for, and checks that every skill a spec names is actually installed.
 *
 * Usage: node scripts/agent-tools-check.mjs [--check]   exit 1 on findings
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

/** Repository root (the parent of `scripts/`). */
const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));

/** Where agent specs live. */
const AGENTS_DIR = join(ROOT, '.claude', 'agents');

/**
 * A skill id must carry a `-` or a `:`.
 *
 * Skills sections quote CLI words in backticks too — `validate`, `format`, `wrangler` —
 * and every installed skill id happens to be hyphenated or namespaced. Requiring one
 * costs nothing and removes the whole class of false positive. A detector that cries
 * wolf gets ignored, which is the failure this file exists to prevent.
 */
const SKILL_ID = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;

/**
 * Collects every skill installed on this machine, by the id an agent would invoke.
 *
 * User-scope skills are bare names; a plugin's skills are `<plugin>:<name>`.
 *
 * @returns {Promise<Set<string>>} The installed skill ids.
 */
async function installedSkills() {
  const found = new Set();

  const userSkills = join(homedir(), '.claude', 'skills');
  for (const entry of await readdir(userSkills, { withFileTypes: true }).catch(() => [])) {
    if (existsSync(join(userSkills, entry.name, 'SKILL.md'))) found.add(entry.name);
  }

  const cache = join(homedir(), '.claude', 'plugins', 'cache');
  for (const market of await readdir(cache, { withFileTypes: true }).catch(() => [])) {
    if (!market.isDirectory()) continue;
    const marketDir = join(cache, market.name);
    for (const plugin of await readdir(marketDir, { withFileTypes: true }).catch(() => [])) {
      if (!plugin.isDirectory()) continue;
      const pluginDir = join(marketDir, plugin.name);
      for (const version of await readdir(pluginDir, { withFileTypes: true }).catch(() => [])) {
        const skills = join(pluginDir, version.name, 'skills');
        for (const skill of await readdir(skills, { withFileTypes: true }).catch(() => [])) {
          if (skill.isDirectory()) found.add(`${plugin.name}:${skill.name}`);
        }
      }
    }
  }

  const projectSkills = join(ROOT, '.claude', 'skills');
  for (const entry of await readdir(projectSkills, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) found.add(entry.name);
  }
  return found;
}

/**
 * Splits a spec into its `tools:` list and its body.
 *
 * @param {string} source - The spec file contents.
 * @returns {{tools: string[], body: string}} The declared tools and everything else.
 */
function parseSpec(source) {
  const line = /^tools:\s*(.+)$/m.exec(source);
  const tools = line ? line[1].split(',').map((t) => t.trim()).filter(Boolean) : [];
  return { tools, body: source };
}

/**
 * Extracts the "Skills you MUST consult" section, where skill ids are named.
 *
 * @param {string} body - The spec body.
 * @returns {string} The section, or an empty string.
 */
function skillsSection(body) {
  const start = body.indexOf('## Skills you MUST consult');
  if (start === -1) return '';
  const rest = body.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Works out what a spec body requires, and which skills it names.
 *
 * Deliberately conservative: a detector that cries wolf gets ignored, which is the
 * failure mode this whole file exists to prevent.
 *
 * @param {string} body - The spec body.
 * @returns {{needs: Set<string>, skills: Set<string>}} Required tools and named skills.
 */
function requirements(body) {
  const needs = new Set();
  const skills = new Set();

  const section = skillsSection(body);
  for (const [, token] of section.matchAll(/`([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)`/g)) {
    if (!SKILL_ID.test(token)) continue;
    if (!token.includes('-') && !token.includes(':')) continue;
    skills.add(token);
  }
  if (skills.size > 0 || /\bSkill\b tool|via the `Skill`/.test(body)) needs.add('Skill');

  for (const [, tool] of body.matchAll(/`?(browser_[a-z_]+)`?/g)) {
    needs.add(`mcp__plugin_playwright_playwright__${tool}`);
  }
  // No inference for Bash: specs quote commands meant for other stages to run, so the
  // signal is too weak to act on. Skill and the browser tools are the two that actually
  // went wrong, and both are unambiguous.

  return { needs, skills };
}

const skills = await installedSkills();
const files = (await readdir(AGENTS_DIR).catch(() => [])).filter((f) => f.endsWith('.md'));
const findings = [];

for (const file of files.sort()) {
  const role = file.replace(/\.md$/, '');
  const { tools, body } = parseSpec(await readFile(join(AGENTS_DIR, file), 'utf8'));
  const { needs, skills: named } = requirements(body);

  for (const need of needs) {
    if (!tools.includes(need)) {
      findings.push(`${role}: spec requires \`${need}\` but tools: does not grant it`);
    }
  }
  for (const skill of named) {
    if (!skills.has(skill)) {
      findings.push(`${role}: names skill \`${skill}\`, which is not installed`);
    }
  }
}

if (findings.length === 0) {
  console.log(`agent tools: current (${files.length} specs, ${skills.size} skills installed)`);
  process.exit(0);
}

console.log('agent tools mismatch:\n');
for (const f of findings) console.log(`  ${f}`);
console.log('\nA stage cannot do what its tools: list does not grant. Fix the list, or the spec.');
process.exit(1);
