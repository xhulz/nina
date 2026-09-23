/**
 * The pipeline graph: reads a project's composed `.claude/graph.md` and says whether it holds.
 *
 * The pipeline used to exist only as prose — a chain table in CLAUDE.md, router.md, pipeline.md,
 * agents-overview.md and the loop-back section of every spec, thirteen documents restating
 * overlapping edges. An audit of it found edges pointing at stages the profile did not compose
 * ("dba and integration-tester run in parallel after the implementer", in a project with
 * neither), a reviewer list that said "three dimensions" and started at 3, and no loop that could
 * ever stop. A graph that lives in prose cannot be checked; one declared once, as lines with a
 * fixed shape, can — and every other document can then be checked against it.
 *
 * Used by `nina check` against a project, and by the compose suite against every fixture, so the
 * rules a graph must satisfy are written once.
 */

import { isLoopBack } from './transcripts.mjs';

/** A stage line: "- `name` — what it does". */
const STAGE = /^- `([a-z][a-z-]*)` — /;

/**
 * An edge line: "- `from` → `to` on `TOKEN` — when · max N". The "when" and the cap are optional;
 * a loop-back edge without a cap is reported, not assumed.
 */
const EDGE = /^- `([a-z][a-z-]*)` → `([a-z][a-z-]*)` on `([A-Z][A-Z-]*)`(?: — (.*?))?(?: · max (\d+))?\s*$/;

/** Where work may end: finished, or handed to the owner. Neither needs a spec. */
export const TERMINALS = new Set(['done', 'human']);


/**
 * Parses a composed graph.
 *
 * @param {string} text - The composed `.claude/graph.md`.
 * @returns {{stages: Set<string>, edges: {from: string, to: string, token: string, when: string, max: number|null, line: number}[], stray: {line: number, text: string}[]}}
 *   `stray` is any list line under "## Edges" that is not a well-formed edge: a typo there would
 *   otherwise drop an edge in silence, which is the failure this file exists to end.
 */
export function parseGraph(text) {
  const stages = new Set();
  const edges = [];
  const stray = [];
  const sections = new Set();
  const twice = [];
  let section = '';
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      section = line.slice(3).trim().toLowerCase();
      sections.add(section);
      return;
    }
    if (section === 'stages') {
      const m = STAGE.exec(line);
      if (m && stages.has(m[1])) twice.push(m[1]);
      if (m) stages.add(m[1]);
    } else if (section === 'edges' && line.startsWith('- ')) {
      const m = EDGE.exec(line);
      if (!m) {
        stray.push({ line: i + 1, text: line });
        return;
      }
      edges.push({ from: m[1], to: m[2], token: m[3], when: m[4] ?? '', max: m[5] ? Number(m[5]) : null, line: i + 1 });
    }
  });
  return { stages, edges, stray, sections, twice };
}

/**
 * The verdict tokens a composed spec tells its stage to emit, from the one sentence every spec
 * states them in: "where `<TOKEN>` is one of `A` or `B`".
 *
 * @param {string} spec - A composed agent spec.
 * @returns {Set<string>}
 */
export function declaredTokens(spec) {
  const tokens = new Set();
  for (const line of spec.split('\n').filter((l) => l.includes('`<TOKEN>` is one of'))) {
    for (const m of line.matchAll(/`([A-Z][A-Z-]+)`/g)) tokens.add(m[1]);
  }
  return tokens;
}

/**
 * The stages a spec's own prose sends work to — "back to **architect**", "→ **reviewer**" — so
 * the prose can be checked against the graph instead of being a second source that drifts from
 * it. Only names that are stages count; bold is used for other things too.
 *
 * @param {string} spec - A composed agent spec.
 * @param {Set<string>} known - Every stage name that could be meant.
 * @returns {Set<string>}
 */
export function proseRoutes(spec, known) {
  const routes = new Set();
  for (const m of spec.matchAll(/(?:back to|→)\s+\*\*([A-Za-z-]+)\*\*/g)) {
    const name = m[1].toLowerCase();
    if (known.has(name)) routes.add(name);
  }
  return routes;
}

/**
 * Everything wrong with a composed graph, given the specs the same profile composed.
 *
 * @param {ReturnType<typeof parseGraph>} graph - The parsed graph.
 * @param {Map<string, string>} specs - Stage name → composed spec text, for every agent on disk.
 * @param {Set<string>} [roles] - Every role the harness defines, composed here or not. A prose
 *   route is checked against this, not against the profile: a spec sending work to a role this
 *   project does not have is precisely the dangling edge, and filtering by what was composed would
 *   hide it.
 * @returns {string[]} One sentence per problem; empty when the graph holds.
 */
export function validateGraph(graph, specs, roles = new Set()) {
  const problems = [];
  const { stages, edges, stray } = graph;

  // A heading typo would otherwise read as "no edges at all" and surface as one complaint per
  // token per stage — a wall that hides the one-word cause.
  for (const needed of ['stages', 'edges']) {
    if (graph.sections && !graph.sections.has(needed)) return [`graph.md has no "## ${needed[0].toUpperCase()}${needed.slice(1)}" section`];
  }
  for (const s of graph.twice ?? []) problems.push(`stage \`${s}\` is listed more than once`);

  for (const s of stray) problems.push(`graph.md:${s.line} is under "## Edges" but is not an edge: ${s.text}`);

  // Every stage is a spec on disk and every spec on disk is a stage — the profile decides both, so
  // a mismatch means a layer named a stage the profile does not compose, or composed one no edge
  // reaches.
  for (const s of stages) if (!specs.has(s)) problems.push(`stage \`${s}\` has no spec in .claude/agents/`);
  for (const s of specs.keys()) if (!stages.has(s)) problems.push(`spec \`${s}\` is not a stage in the graph`);

  for (const e of edges) {
    for (const end of [e.from, e.to]) {
      if (!stages.has(end) && !TERMINALS.has(end)) {
        problems.push(`graph.md:${e.line} points at \`${end}\`, which this project does not compose`);
      }
    }
    const tokens = specs.has(e.from) ? declaredTokens(specs.get(e.from)) : null;
    if (tokens && tokens.size > 0 && !tokens.has(e.token)) {
      problems.push(`graph.md:${e.line}: \`${e.from}\` never emits \`${e.token}\` — its spec declares ${[...tokens].join(', ')}`);
    }
    // A loop with no cap can run forever, and nothing in the pipeline would stop it.
    if (isLoopBack(e.token) && !TERMINALS.has(e.to) && e.max === null) {
      problems.push(`graph.md:${e.line}: loop-back \`${e.from}\` → \`${e.to}\` has no cap — add "· max N"`);
    }
  }

  // The loop gate reads one cap per edge. Two lines naming the same edge with different caps would
  // leave it guessing which one holds; it would take the larger, but a graph should not need a
  // tie-breaker.
  const caps = new Map();
  for (const e of edges) {
    if (e.max === null) continue;
    const key = `${e.from}|${e.to}|${e.token}`;
    const seen = caps.get(key);
    if (!seen) caps.set(key, e);
    else if (seen.max !== e.max) {
      problems.push(`graph.md:${e.line}: \`${e.from}\` → \`${e.to}\` on \`${e.token}\` is capped at ${e.max} here and at ${seen.max} on line ${seen.line} — one edge, one cap`);
    }
  }

  // Every verdict a stage can emit goes somewhere. A token with no outgoing edge is a report the
  // orchestrator has no rule for.
  for (const [name, spec] of specs) {
    for (const token of declaredTokens(spec)) {
      if (!edges.some((e) => e.from === name && e.token === token)) {
        problems.push(`\`${name}\` can report \`${token}\`, and no edge says where that goes`);
      }
    }
  }

  // The prose may describe the graph but not contradict it: a route a spec names that the graph
  // lacks is a second source of truth, which is how the edges drifted in the first place.
  const known = new Set([...stages, ...specs.keys(), ...roles]);
  for (const [name, spec] of specs) {
    for (const to of proseRoutes(spec, known)) {
      if (to === name) continue;
      if (!stages.has(to)) {
        problems.push(`\`${name}\`'s spec sends work to \`${to}\`, which this project does not compose`);
      } else if (!edges.some((e) => e.from === name && e.to === to)) {
        problems.push(`\`${name}\`'s spec sends work to \`${to}\`, and the graph has no such edge`);
      }
    }
  }
  return problems;
}
