/**
 * `nina pipeline` — draws a project's agent chain: the line work moves along, the gates it passes on the
 * way, the stages that run as several agents at once, where each stage sends work back and how many rounds
 * it may, each stage's model, effort and skills with what it did over the last thirty days, and which chain
 * a task of each shape takes. `--for` draws one shape's chain alone.
 *
 * Opening a project, the pipeline was a graph, a router, ten specs and a table in CLAUDE.md to read before
 * anyone could say which stage came after which, on which model, with which skills. Every fact here is
 * already composed, and `nina check` already holds it to the graph, or already measured; this only reads it
 * back and draws it.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dim, pink } from '../look.mjs';
import { HARNESS, slugFor, snapshotsDir } from '../paths.mjs';
import { TERMINALS, parseGraph } from '../graph.mjs';
import { required } from '../tools.mjs';
import { isLoopBack } from '../transcripts.mjs';
import { frontmatter } from './pills.mjs';

/** A stage line under "## Stages": "- `name` — what it does". */
const STAGE_LINE = /^- `([a-z][a-z-]*)` — (.*)$/;

/** How far back the history beside each stage looks, unless `--since` says. */
const HISTORY_DAYS = 30;

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
 * - The loop-backs: every edge on a verdict that sends work back, to a stage or to the owner, grouped by
 *   the stage that sends it.
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
  const back = graph.edges.filter((e) => isLoopBack(e.token)).sort((a, b) => order.indexOf(a.from) - order.indexOf(b.from));
  return { line, gates, ends, back };
}

/**
 * The rows of the "Required chain by task shape" table in a composed CLAUDE.md: the shape, and the chain it
 * takes — the part the table sets in bold, where it does. A row whose chain runs stage → stage, or is
 * "none", is a chain of its own; any other (`+ dba before reviewer`) is an add-on to whichever chain the
 * task takes.
 *
 * @param {string} text - The composed CLAUDE.md.
 * @returns {{shape: string, chain: string, addOn: boolean}[]}
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
    const taken = plain(bold ?? chain);
    rows.push({ shape: plain(shape), chain: taken, addOn: !taken.includes('→') && !/^none\b/i.test(taken) });
  }
  return rows;
}

/**
 * The task shapes a `--for` names: by its number in the list, or by every word it gives.
 *
 * @param {{shape: string}[]} shapes - The chain table's rows.
 * @param {string} query - A number, or words.
 * @returns {object[]}
 */
export function pickShape(shapes, query) {
  if (/^\d+$/.test(query.trim())) {
    const row = shapes[Number(query) - 1];
    return row ? [row] : [];
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return shapes.filter((r) => words.every((w) => r.shape.toLowerCase().includes(w)));
}

/**
 * What each stage did since a date, from the measurement store: its runs, the verdicts that could be read,
 * and how many of those sent work back. A run a hook denied never ran, and is not counted.
 *
 * @param {object[]} records - The project's records.
 * @param {string} since - An ISO date.
 * @returns {Map<string, {runs: number, read: number, back: number}>}
 */
export function historyOf(records, since) {
  const byRole = new Map();
  for (const r of records) {
    if (!r.role || r.status === 'denied' || String(r.ts ?? '') < since) continue;
    const s = byRole.get(r.role) ?? { runs: 0, read: 0, back: 0 };
    s.runs += 1;
    if (r.verdict && r.verdict !== 'UNCLEAR' && r.verdict !== 'NONE') {
      s.read += 1;
      if (isLoopBack(r.verdict)) s.back += 1;
    }
    byRole.set(r.role, s);
  }
  return byRole;
}

/**
 * The project's records in the measurement store, under the name Claude Code gives its directory — as
 * given, or with its links resolved, since either may be the one the sessions ran in.
 *
 * @param {string} dir - The project.
 * @returns {object[]|null} Null when the store has nothing for it.
 */
function storedRuns(dir) {
  const names = new Set([slugFor(dir)]);
  try {
    names.add(slugFor(realpathSync(dir)));
  } catch {
    // A directory that cannot be resolved is looked up as given.
  }
  for (const name of names) {
    const file = join(snapshotsDir(), `${name}.jsonl`);
    if (!existsSync(file)) continue;
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  }
  return null;
}

/**
 * Runs the command.
 *
 * @param {string[]} argv - `[--project <dir>] [--for <number or words>] [--since <YYYY-MM-DD>]`.
 * @returns {Promise<number>} Process exit code.
 */
export async function pipeline(argv) {
  const arg = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] ?? '' : null);
  const dir = resolve(arg('--project') ?? process.cwd());
  const graphPath = join(dir, '.claude', 'graph.md');
  if (!existsSync(graphPath)) {
    console.error(`  no .claude/graph.md in ${dir} — this draws a composed pipeline: \`nina compose\` writes one`);
    return 1;
  }
  const graphText = readFileSync(graphPath, 'utf8');
  const graph = parseGraph(graphText);
  const words = stageWords(graphText);
  const shape = shapeOf(graph);
  const claude = join(dir, 'CLAUDE.md');
  const shapes = existsSync(claude) ? chainsByShape(readFileSync(claude, 'utf8')) : [];

  // `--for`: one shape's chain, and only the stages on it.
  const query = arg('--for');
  let chosen = null;
  if (query !== null) {
    const picked = pickShape(shapes, query);
    if (picked.length !== 1) {
      console.error(picked.length === 0 ? `  no task shape matches "${query}" — by number or by words:` : `  "${query}" matches ${picked.length} task shapes — narrow it, or give the number:`);
      for (const [i, r] of shapes.entries()) if (picked.length === 0 || picked.includes(r)) console.error(`    ${String(i + 1).padStart(2)}  ${r.shape}`);
      return 1;
    }
    chosen = picked[0];
  }

  const name = (s) => (TERMINALS.has(s) ? s : pink(s));
  const width = Math.max(80, Math.min(process.stdout.columns ?? 110, 140));
  const fit = (s, room) => (s.length > room ? `${s.slice(0, Math.max(room - 1, 1))}…` : s);
  const arrow = ' ─▶ ';
  const many = graph.many ?? new Map();
  // A stage that may run as several agents at once carries ×n wherever the line draws it. Alignment is
  // counted on the plain text, and the names are painted after.
  const plainStage = (s) => `${s}${many.has(s) ? ' ×n' : ''}`;
  const shownStage = (s) => `${name(s)}${many.has(s) ? ' ×n' : ''}`;
  const padName = (s, n) => `${name(s)}${' '.repeat(Math.max(n - s.length, 1))}`;

  let profile = {};
  try {
    profile = JSON.parse(readFileSync(join(dir, HARNESS, 'profile.json'), 'utf8'));
  } catch {
    // A pipeline composed by hand draws all the same; only the header has less to say.
  }
  const surfaces = (profile.surfaces ?? []).slice().sort();
  console.log(`  pipeline · ${basename(dir)}${profile.core ? ` · core ${profile.core}` : ''}${surfaces.length ? ` · surfaces ${surfaces.join(', ')}` : ''}`);

  // The stages this drawing covers: all of them, or those the chosen shape's chain names.
  const onChain = chosen ? (chosen.chain.match(/[a-z][a-z-]*/g) ?? []).filter((w) => graph.stages.has(w)) : null;
  const covered = new Set(onChain ?? graph.stages);

  if (chosen) {
    console.log(`  for: ${chosen.shape}\n`);
    if (onChain.length === 0) console.log(`  ${chosen.chain}`);
    else console.log(`  ${onChain.map(shownStage).join(arrow)}`);
    const addOns = shapes.filter((r) => r.addOn && r !== chosen);
    if (addOns.length > 0 && onChain.length > 0) {
      console.log(`\n  ${dim('and, when the change calls for them')}`);
      const col = Math.min(Math.max(...addOns.map((r) => r.chain.length)), 44) + 4;
      for (const r of addOns) console.log(`    ${fit(r.chain, col - 4).padEnd(col)}${dim(fit(r.shape, width - col - 6))}`);
    }
  } else {
    console.log('');
    // The line, and where its last stage sends work.
    const plainHead = `  ${shape.line.map(plainStage).join(arrow)}`;
    const head = `  ${shape.line.map(shownStage).join(arrow)}`;
    if (shape.ends.length === 0) console.log(head);
    const lead = ' '.repeat(plainHead.length + 1);
    const joint = (i) => (shape.ends.length === 1 ? '──▶ ' : i === 0 ? '─┬─▶ ' : i === shape.ends.length - 1 ? ' └─▶ ' : ' ├─▶ ');
    const endCol = Math.max(0, ...shape.ends.map((end, i) => `${lead}${joint(i)}${end.path.join(arrow)}`.length)) + 3;
    shape.ends.forEach((end, i) => {
      const plain = `${lead}${joint(i)}${end.path.join(arrow)}`;
      console.log(`${i === 0 ? `${head} ` : lead}${joint(i)}${end.path.map(name).join(arrow)}${' '.repeat(endCol - plain.length)}${dim(fit(end.when, width - endCol))}`);
    });

    if (shape.gates.length > 0) {
      console.log(`\n  ${dim('gates on the way, when the diff calls for them')}`);
      const chain = (g) => `${g.from}${arrow}${g.gate}${arrow}${g.to}`;
      const col = Math.max(...shape.gates.map((g) => chain(g).length)) + 4;
      for (const g of shape.gates) {
        console.log(`    ${name(g.from)}${arrow}${name(g.gate)}${arrow}${name(g.to)}${' '.repeat(col - chain(g).length)}${dim(fit(g.when, width - col - 6))}`);
      }
    }
  }

  const drawnMany = [...many].filter(([s]) => covered.has(s));
  if (drawnMany.length > 0) {
    console.log(`\n  ${dim('×n  runs as several agents at once, each on its own share of the work')}`);
    const col = Math.max(...drawnMany.map(([s]) => s.length)) + 3;
    for (const [s, { when }] of drawnMany) console.log(`      ${padName(s, col)}${dim(fit(when, width - col - 8))}`);
  }

  const back = shape.back.filter((e) => covered.has(e.from) && (covered.has(e.to) || TERMINALS.has(e.to)));
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

  // Each stage: what it does, on which model and effort, with which skills, and what it did lately.
  const agentsDir = join(dir, '.claude', 'agents');
  const specs = new Map();
  for (const file of existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort() : []) {
    specs.set(file.replace(/\.md$/, ''), readFileSync(join(agentsDir, file), 'utf8'));
  }
  const since = arg('--since') || new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const runs = storedRuns(dir);
  const history = runs ? historyOf(runs, since) : null;
  const stages = [...graph.stages].filter((s) => covered.has(s));
  const col = Math.max(...stages.map((s) => s.length), 10) + 2;
  console.log(`\n  ${dim(history ? `stages · what each ran since ${since}, from the measured history` : 'stages · no measured history for this project yet')}`);
  for (const stage of stages) {
    const spec = specs.get(stage) ?? '';
    const front = frontmatter(spec) ?? {};
    const on = [front.model, front.effort].filter(Boolean).join(' · ') || 'no spec';
    console.log(`    ${padName(stage, col)}${on.padEnd(26)}${dim(fit(words.get(stage) ?? '', width - col - 32))}`);
    if (history) {
      const h = history.get(stage);
      const said = !h
        ? 'no run'
        : `${h.runs} run(s)${h.read === 0 ? ', no verdict read' : `, sent back ${h.back} of ${h.read} (${Math.round((100 * h.back) / h.read)}%)`}`;
      console.log(`    ${' '.repeat(col)}${dim('ran     ')}${said}`);
    }
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

  if (!chosen) {
    // An agent the project wrote for itself is not a stage, and the graph does not route to it.
    const own = [...specs.keys()].filter((role) => !graph.stages.has(role));
    if (own.length > 0) {
      console.log(`\n  ${dim("the project's own agents, outside the pipeline")}`);
      for (const role of own) {
        const front = frontmatter(specs.get(role)) ?? {};
        console.log(`    ${role}${' '.repeat(Math.max(col - role.length, 2))}${dim(fit(front.description ?? '', width - col - 6))}`);
      }
    }
    if (shapes.length > 0) {
      console.log(`\n  ${dim('which chain a task takes, by its shape (CLAUDE.md) — `nina pipeline --for <number or words>` draws one')}`);
      const shapeCol = Math.min(Math.max(...shapes.map((r) => r.shape.length)), 56) + 2;
      for (const [i, r] of shapes.entries()) {
        console.log(`    ${String(i + 1).padStart(2)}  ${fit(r.shape, shapeCol - 2).padEnd(shapeCol)}${fit(r.chain, width - shapeCol - 10)}`);
      }
    }
  }
  console.log('');
  return 0;
}
