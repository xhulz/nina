/**
 * `nina pipeline` — draws a project's agent chain: the line work moves along, the gates it passes on the
 * way, where each stage sends work back and how many rounds it may, each stage's model, effort and skills,
 * and which chain a task of each shape takes.
 *
 * Opening a project, the pipeline was a graph, a router, ten specs and a table in CLAUDE.md to read before
 * anyone could say which stage came after which, on which model, with which skills. Every fact here is
 * already composed, and `nina check` already holds it to the graph; this only reads it back and draws it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { PINK, useColor } from '../banner.mjs';
import { HARNESS } from '../paths.mjs';
import { TERMINALS, parseGraph } from '../graph.mjs';
import { required } from '../tools.mjs';
import { isLoopBack } from '../transcripts.mjs';
import { frontmatter } from './pills.mjs';

/** A stage line under "## Stages": "- `name` — what it does". */
const STAGE_LINE = /^- `([a-z][a-z-]*)` — (.*)$/;

/**
 * What each stage does, in the graph's own words: shorter than a spec's `description:`, which is written
 * for Claude Code to choose an agent by.
 *
 * @param {string} text - The composed `.claude/graph.md`.
 * @returns {Map<string, string>}
 */
export function stageWords(text) {
  const out = new Map();
  let inStages = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) inStages = line.slice(3).trim().toLowerCase() === 'stages';
    else if (inStages) {
      const m = STAGE_LINE.exec(line);
      if (m) out.set(m[1], m[2].trim());
    }
  }
  return out;
}

/**
 * The shape of the pipeline, read from its edges.
 *
 * - The line: from the first stage no forward edge reaches, the one forward edge each stage takes with no
 *   condition, until a stage has none.
 * - The gates: a stage off the line that a line stage sends work to on a condition, and that hands it on
 *   to the next stage of the line.
 * - The ends: where the line's last stage sends work on a condition, followed forward to a terminal.
 * - The loop-backs: every edge on a verdict that sends work back, to a stage or to the owner.
 *
 * @param {{stages: Set<string>, edges: object[]}} graph - A parsed graph.
 * @returns {{line: string[], gates: object[], ends: object[], back: object[]}}
 */
export function shapeOf(graph) {
  const forward = graph.edges.filter((e) => !isLoopBack(e.token));
  const order = [...graph.stages];
  const start = order.find((s) => !forward.some((e) => e.to === s)) ?? order[0];
  const line = start ? [start] : [];
  for (;;) {
    const next = forward.filter((e) => e.from === line.at(-1) && !e.when && !line.includes(e.to) && !TERMINALS.has(e.to));
    if (next.length !== 1) break;
    line.push(next[0].to);
  }
  const gates = [];
  line.forEach((stage, i) => {
    for (const e of forward.filter((e) => e.from === stage && e.when && !line.includes(e.to) && !TERMINALS.has(e.to))) {
      if (i + 1 < line.length && forward.some((f) => f.from === e.to && f.to === line[i + 1])) gates.push({ from: stage, gate: e.to, to: line[i + 1], when: e.when });
    }
  });
  const last = line.at(-1);
  const ends = forward
    .filter((e) => e.from === last && e.when)
    .map((e) => {
      const path = [e.to];
      while (!TERMINALS.has(path.at(-1))) {
        const on = forward.filter((f) => f.from === path.at(-1) && !path.includes(f.to));
        if (on.length !== 1) break;
        path.push(on[0].to);
      }
      return { path, when: e.when };
    });
  // Grouped by the stage that sends the work back, in the order the stages are listed.
  const back = graph.edges.filter((e) => isLoopBack(e.token)).sort((a, b) => order.indexOf(a.from) - order.indexOf(b.from));
  return { line, gates, ends, back };
}

/**
 * The rows of the "Required chain by task shape" table in a composed CLAUDE.md: the shape, and the chain it
 * takes — the part the table sets in bold, where it does.
 *
 * @param {string} text - The composed CLAUDE.md.
 * @returns {{shape: string, chain: string}[]}
 */
export function chainsByShape(text) {
  const at = text.indexOf('| Task shape |');
  if (at === -1) return [];
  const rows = [];
  for (const row of text.slice(at).split('\n').slice(2)) {
    if (!row.startsWith('|')) break;
    const [shape = '', chain = ''] = row.split('|').slice(1).map((c) => c.trim());
    const bold = /\*\*(.+?)\*\*/.exec(chain)?.[1];
    const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();
    rows.push({ shape: plain(shape), chain: plain(bold ?? chain) });
  }
  return rows;
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - `[--project <dir>]`.
 * @returns {Promise<number>} Process exit code.
 */
export async function pipeline(argv) {
  const dir = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : process.cwd());
  const graphPath = join(dir, '.claude', 'graph.md');
  if (!existsSync(graphPath)) {
    console.error(`  no .claude/graph.md in ${dir} — this draws a composed pipeline: \`nina compose\` writes one`);
    return 1;
  }
  const graph = parseGraph(readFileSync(graphPath, 'utf8'));
  const words = stageWords(readFileSync(graphPath, 'utf8'));
  const { line, gates, ends, back } = shapeOf(graph);

  const color = useColor();
  const name = (s) => (color && !TERMINALS.has(s) ? `\x1b[38;2;${PINK.join(';')}m${s}\x1b[0m` : s);
  const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const width = Math.max(80, Math.min(process.stdout.columns ?? 110, 140));
  const fit = (s, room) => (s.length > room ? `${s.slice(0, Math.max(room - 1, 1))}…` : s);
  const arrow = ' ─▶ ';

  let profile = {};
  try {
    profile = JSON.parse(readFileSync(join(dir, HARNESS, 'profile.json'), 'utf8'));
  } catch {
    // A pipeline composed by hand draws all the same; only the header has less to say.
  }
  const surfaces = (profile.surfaces ?? []).slice().sort();
  console.log(`  pipeline · ${basename(dir)}${profile.core ? ` · core ${profile.core}` : ''}${surfaces.length ? ` · surfaces ${surfaces.join(', ')}` : ''}\n`);

  // Alignment is counted on the plain text, and the names are painted after.
  const padName = (s, n) => `${name(s)}${' '.repeat(Math.max(n - s.length, 1))}`;

  // The line, and where its last stage sends work.
  const plainHead = `  ${line.join(arrow)}`;
  const head = `  ${line.map(name).join(arrow)}`;
  if (ends.length === 0) console.log(head);
  const lead = ' '.repeat(plainHead.length + 1);
  const joint = (i) => (ends.length === 1 ? '──▶ ' : i === 0 ? '─┬─▶ ' : i === ends.length - 1 ? ' └─▶ ' : ' ├─▶ ');
  const endCol = Math.max(0, ...ends.map((end, i) => `${lead}${joint(i)}${end.path.join(arrow)}`.length)) + 3;
  ends.forEach((end, i) => {
    const plain = `${lead}${joint(i)}${end.path.join(arrow)}`;
    console.log(`${i === 0 ? `${head} ` : lead}${joint(i)}${end.path.map(name).join(arrow)}${' '.repeat(endCol - plain.length)}${dim(fit(end.when, width - endCol))}`);
  });

  if (gates.length > 0) {
    console.log(`\n  ${dim('gates on the way, when the diff calls for them')}`);
    const chain = (g) => `${g.from}${arrow}${g.gate}${arrow}${g.to}`;
    const col = Math.max(...gates.map((g) => chain(g).length)) + 4;
    for (const g of gates) {
      console.log(`    ${name(g.from)}${arrow}${name(g.gate)}${arrow}${name(g.to)}${' '.repeat(col - chain(g).length)}${dim(fit(g.when, width - col - 6))}`);
    }
  }

  if (back.length > 0) {
    console.log(`\n  ${dim('sent back: to whom, on which verdict, and how many rounds per issue')}`);
    const fromCol = Math.max(...back.map((e) => e.from.length)) + 2;
    const toCol = Math.max(...back.map((e) => e.to.length)) + 2;
    const tokenCol = Math.max(...back.map((e) => e.token.length)) + 2;
    let previous = '';
    for (const e of back) {
      const from = e.from === previous ? '' : e.from;
      previous = e.from;
      const rounds = e.to === 'human' ? '—' : e.max === null ? '?' : String(e.max);
      const tail = `${e.token.padEnd(tokenCol)}${rounds.padStart(2)}   `;
      const used = 4 + fromCol + 2 + toCol + tail.length;
      console.log(`    ${from ? padName(from, fromCol) : ' '.repeat(fromCol)}↩ ${padName(e.to, toCol)}${tail}${dim(fit(e.when ?? '', width - used))}`);
    }
  }

  // Each stage: what it does, on which model and effort, with which skills.
  const agentsDir = join(dir, '.claude', 'agents');
  const specs = new Map();
  for (const file of existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort() : []) {
    specs.set(file.replace(/\.md$/, ''), readFileSync(join(agentsDir, file), 'utf8'));
  }
  const stages = [...graph.stages];
  const col = Math.max(...stages.map((s) => s.length), 10) + 2;
  console.log(`\n  ${dim('stages')}`);
  for (const stage of stages) {
    const spec = specs.get(stage) ?? '';
    const front = frontmatter(spec) ?? {};
    const runs = [front.model, front.effort].filter(Boolean).join(' · ') || 'no spec';
    console.log(`    ${padName(stage, col)}${runs.padEnd(26)}${dim(fit(words.get(stage) ?? '', width - col - 32))}`);
    const skills = [...required(spec).skills].sort();
    if (skills.length > 0) {
      const lines = [];
      let current = '';
      for (const skill of skills) {
        const next = current ? `${current} · ${skill}` : skill;
        if (next.length > width - col - 16 && current) {
          lines.push(current);
          current = skill;
        } else current = next;
      }
      lines.push(current);
      lines.forEach((l, i) => console.log(`    ${' '.repeat(col)}${dim(i === 0 ? 'skills  ' : '        ')}${l}`));
    }
  }

  // An agent the project wrote for itself is not a stage, and the graph does not route to it.
  const own = [...specs.keys()].filter((role) => !graph.stages.has(role));
  if (own.length > 0) {
    console.log(`\n  ${dim("the project's own agents, outside the pipeline")}`);
    for (const role of own) {
      const front = frontmatter(specs.get(role)) ?? {};
      console.log(`    ${role}${' '.repeat(Math.max(col - role.length, 2))}${dim(fit(front.description ?? '', width - col - 6))}`);
    }
  }

  const claude = join(dir, 'CLAUDE.md');
  const shapes = existsSync(claude) ? chainsByShape(readFileSync(claude, 'utf8')) : [];
  if (shapes.length > 0) {
    console.log(`\n  ${dim('which chain a task takes, by its shape (CLAUDE.md)')}`);
    const shapeCol = Math.min(Math.max(...shapes.map((r) => r.shape.length)), 58) + 2;
    for (const r of shapes) console.log(`    ${fit(r.shape, shapeCol - 2).padEnd(shapeCol)}${fit(r.chain, width - shapeCol - 6)}`);
  }
  console.log('');
  return 0;
}
