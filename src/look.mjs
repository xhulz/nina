/**
 * How a report looks on a terminal: the banner's pink for stage names and section marks, dim for what
 * explains, amber for what needs looking at, bars for shares, and lines wrapped to the window.
 *
 * Only on a terminal, and never under `NO_COLOR`. Piped, a report is the same lines, uncoloured and
 * unwrapped, so `grep` still finds a whole sentence and a test still reads it; the bars stay, since a
 * block character reads the same anywhere.
 */

import { PINK, useColor } from './banner.mjs';

/** An amber for what needs looking at, and a green for what is sound: bright enough on dark and light. */
const AMBER = [230, 160, 40];
const GREEN = [90, 180, 110];

const rgb = ([r, g, b], s) => (useColor() ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : String(s));

/** Text in the banner's pink: a stage's name, a section's mark. */
export const pink = (s) => rgb(PINK, s);
/** Text that explains rather than reports. */
export const dim = (s) => (useColor() ? `\x1b[2m${s}\x1b[0m` : String(s));
/** Text that carries the number a line is about. */
export const bold = (s) => (useColor() ? `\x1b[1m${s}\x1b[0m` : String(s));
/** Text that needs looking at. */
export const amber = (s) => rgb(AMBER, s);
/** Text that says something is sound. */
export const green = (s) => rgb(GREEN, s);

/** The width lines wrap at on a terminal; a pipe is never wrapped. */
const width = () => Math.max(80, Math.min(process.stdout.columns ?? 120, 140));

/**
 * A section's heading: its name, and what the section is about. Printed plain it reads as it always did,
 * "name — what"; on a terminal the name is marked and the explanation dimmed.
 *
 * @param {string} name - The section.
 * @param {string} [about] - What it covers.
 * @returns {string}
 */
export function heading(name, about = '') {
  if (!useColor()) return `\n  ${name}${about ? ` — ${about}` : ''}`;
  const lead = `  ▌ ${name} `;
  return `\n${pink('  ▌')} ${bold(pink(name))}${about ? ` ${dim(wrapped(`— ${about}`, lead.length, lead.length + 2))}` : ''}`;
}

/**
 * A line of prose under a section, wrapped to the window on a terminal with its continuation indented
 * under its first word, and marked: `·` for what it reports, `!` in amber for what needs looking at, `✓`
 * in green for what is sound.
 *
 * @param {string} text - The sentence.
 * @param {'info'|'warn'|'ok'} [kind] - What it is.
 * @returns {string}
 */
export function note(text, kind = 'info') {
  if (!useColor()) return `    ${text}`;
  const mark = kind === 'warn' ? amber('!') : kind === 'ok' ? green('✓') : dim('·');
  const body = wrapped(text, 6, 6);
  return `    ${mark} ${kind === 'warn' ? amber(body) : body}`;
}

/**
 * Wraps text at the window's width. The first line starts `first` columns in; the rest are indented by
 * `rest`. Words are never split.
 *
 * @param {string} text - The text.
 * @param {number} first - Where the first line starts.
 * @param {number} rest - The indent of every other line.
 * @returns {string}
 */
export function wrapped(text, first, rest) {
  const room = width();
  const lines = [];
  let line = '';
  let at = first;
  for (const word of text.split(' ')) {
    if (line && at + line.length + 1 + word.length > room) {
      lines.push(line);
      line = word;
      at = rest;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.join(`\n${' '.repeat(rest)}`);
}

/** Eighths of a block, for the fraction a bar ends on. */
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/**
 * A bar as long as a share of `cells`, ending on an eighth of a block.
 *
 * @param {number} fraction - From 0 to 1.
 * @param {number} cells - How long a whole one is.
 * @returns {string}
 */
export function bar(fraction, cells) {
  const eighths = Math.round(Math.max(0, Math.min(1, fraction)) * cells * 8);
  return `${'█'.repeat(Math.floor(eighths / 8))}${EIGHTHS[eighths % 8]}`;
}

/**
 * A bar split into parts, one character per part so it reads uncoloured: `█` for what went forward, `▓`
 * for what was sent back, `░` for what said nothing readable. Each part is at least one cell when it is
 * not zero, so a single run sent back in a hundred still shows.
 *
 * @param {{n: number, char: string, paint: (s: string) => string}[]} parts - In order.
 * @param {number} cells - How long the bar is.
 * @returns {string}
 */
export function stacked(parts, cells) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (total === 0 || cells <= 0) return '';
  const sizes = parts.map((p) => (p.n > 0 ? Math.max(1, Math.round((p.n / total) * cells)) : 0));
  // Trim the rounding back to the length asked for, from the largest part.
  while (sizes.reduce((a, b) => a + b, 0) > cells) sizes[sizes.indexOf(Math.max(...sizes))] -= 1;
  return parts.map((p, i) => p.paint(p.char.repeat(sizes[i]))).join('');
}
