/**
 * The lessons a stage is handed as it starts: the list of its active pills, each with the trigger that says
 * when it applies, given to the subagent by the `SubagentStart` hook.
 *
 * Every spec told its stage to read its pills, and a stage found them by opening files: every pill in its own
 * directory, and every shared one to see whether its `applies_to` named it. So a reviewer read one in only
 * seven of fifteen runs while twelve applied to it, and a stage no pill named opened them in two runs of three.
 * Handed the list, a stage opens the ones whose trigger matches its task, and nothing else.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { frontmatter, list } from './commands/pills.mjs';

/** How much of a trigger goes in the list: enough to say when, not the lesson. */
const TRIGGER_CHARS = 160;

/**
 * A stage's lessons as the text handed to it, or null when it has none.
 *
 * @param {string} root - The project directory.
 * @param {string} role - The stage.
 * @returns {string|null}
 */
export function lessonIndex(root, role) {
  const found = [];
  for (const sub of [role, 'shared']) {
    let files = [];
    try {
      files = readdirSync(join(root, '.claude', 'pills', sub)).filter((f) => f.endsWith('.md')).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      let fields = null;
      try {
        fields = frontmatter(readFileSync(join(root, '.claude', 'pills', sub, file), 'utf8'));
      } catch {
        continue;
      }
      if (!fields || fields.status === 'retired') continue;
      const applies = list(fields.applies_to);
      // A shared pill is this stage's when it names it; one in the stage's own directory, unless it names others.
      if (sub === 'shared' ? !applies.includes(role) : applies.length > 0 && !applies.includes(role)) continue;
      const trigger = String(fields.trigger ?? '').replace(/\s+/g, ' ').trim();
      const when = trigger ? `when ${trigger.length > TRIGGER_CHARS ? `${trigger.slice(0, TRIGGER_CHARS - 1)}…` : trigger}` : 'on every task';
      found.push(`- \`.claude/pills/${sub}/${file}\` — ${when}`);
    }
  }
  if (found.length === 0) return null;
  return [
    `Your lessons in this project, ${found.length}: before acting, open each one whose trigger matches this task, and only those.`,
    ...found,
  ].join('\n');
}
