#!/usr/bin/env node
/**
 * Composes every fixture project and asserts the invariants that replaced byte-exactness.
 *
 * While the harness was being extracted, the test was that a composition reproduced a live
 * project byte for byte. That oracle is gone: projects now pin a frozen release, so the
 * working core has no running tree to be checked against. What stands in its place is a
 * fixture project per shape worth testing, and nine properties that must hold for each:
 *
 *   1. No `{{PLACEHOLDER}}` survives — the profile's vocabulary covers what the core says.
 *   2. Every unfilled slot belongs to the PROJECT layer. A declared surface that leaves one
 *      of its own slots empty is a bug: the core expects text there and nothing supplies it.
 *   3. Nothing from an undeclared surface leaks in, per the fixture's deny list.
 *   4. Files gated on a surface appear, or do not, as the fixture expects.
 *   5. Every `Hard Rule #N` reference points at a rule that exists in the composed CLAUDE.md.
 *      The hard rules are a numbered list assembled from several layers, so a project that does
 *      not declare a surface simply has no rule where that surface's rule would have been — and
 *      a reference to it, written by a layer that IS present, points at nothing.
 *   6. Every composed file carries the `nina:generated` notice, below its frontmatter rather
 *      than above it — the notice is what tells an agent to edit the layer instead of the
 *      output, and misplacing it silently un-dispatches a subagent spec.
 *   8. The composed `.claude/graph.md` holds for the profile that composed it: every stage has a
 *      spec and every spec is a stage, no edge points at a stage the profile lacks, every verdict a
 *      stage can emit goes somewhere, every loop-back has a cap, and no spec's prose names a route
 *      the graph does not have. See src/graph.mjs.
 *   7. Every composed agent spec declares `name:`, `description:` and `tools:` in its frontmatter.
 *      Claude Code does not load a spec with no description at all; and one with no `tools:` is not
 *      restricted — the subagent inherits every tool the session has — so a role told it is
 *      read-only is not, and nothing says so. A `model:` it declares is an alias or a model id.
 *   9. Every numbered list composes as 1, 2, 3 — except the hard rules, whose numbers are ids.
 *  10. Every composed document fits its size budget (`BUDGETS`), and no `nina:why` passage survives.
 *      Every dispatch pays for what its spec says, so a file that grows past its budget is a decision to
 *      make in the commit that raises it, not an accretion nobody chose.
 *
 * Usage: node scripts/compose-test.mjs [--verbose]
 */

import { cp, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { parseGraph, validateGraph } from '../src/graph.mjs';
import { frontmatterFindings, modelFindings, toolFindings } from '../src/tools.mjs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRES, SLOT, composeProject, defaultsTree, stripWhy } from '../src/commands/compose.mjs';
import { NOTICE_HEAD } from '../src/guard.mjs';
import { ANSWERED, answers } from '../src/commands/learn.mjs';

const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const verbose = process.argv.includes('--verbose');

/** Every file under a directory, as paths relative to it. */
async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const rel = join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

/**
 * Runs one fixture.
 *
 * @param {string} name - The fixture directory name.
 * @returns {Promise<string[]>} Failures, empty when the fixture passes.
 */
async function runFixture(name) {
  const source = join(ROOT, 'fixtures', name);
  const expect = JSON.parse(await readFile(join(source, 'expect.json'), 'utf8'));
  const work = await mkdtemp(join(tmpdir(), `nina-${name}-`));
  await cp(join(source, '.nina'), join(work, '.nina'), { recursive: true });

  const result = await composeProject(work, { root: ROOT });
  if (result.error) return [result.error];

  const failures = [];

  // 2. A declared surface must fill every slot it claims.
  const surfaceSlots = result.unfilled.filter((s) => !s.includes(' project.'));
  for (const slot of surfaceSlots) failures.push(`declared surface left a slot empty: ${slot}`);

  const composed = (await walk(work)).filter((f) => !f.startsWith('.nina'));

  /** The hard rules this project actually composed, by number. */
  const rules = new Set(
    [...(await readFile(join(work, 'CLAUDE.md'), 'utf8').catch(() => ''))
      .matchAll(/^(\d+)\. \*\*/gm)].map((m) => m[1]),
  );

  for (const rel of composed) {
    const text = await readFile(join(work, rel), 'utf8');

    // 10. The file fits its budget, and carries none of the history the layers mark as `nina:why`.
    if (rel.endsWith('.md') && !(rel in BUDGETS)) failures.push(`${rel}: composed with no size budget — add one to BUDGETS, deliberately`);
    else if (rel in BUDGETS && text.length > BUDGETS[rel]) failures.push(`${rel}: ${text.length} characters, over its budget of ${BUDGETS[rel]}`);
    if (text.includes('nina:why')) failures.push(`${rel}: a nina:why passage survived composition`);

    // 5. A reference to a rule number that this project does not have.
    for (const match of text.matchAll(/#(\d+)/g)) {
      const context = text.slice(Math.max(0, match.index - 30), match.index);
      if (!/rule/i.test(context)) continue;
      if (!rules.has(match[1])) {
        const line = text.slice(0, match.index).split('\n').length;
        failures.push(`${rel}:${line}: refers to Hard Rule #${match[1]}, which this project has no rule for`);
      }
    }

    // 1. The vocabulary covers what the core says.
    for (const hole of new Set(text.match(/\{\{[A-Z_]+\}\}/g) ?? [])) {
      failures.push(`${rel}: unresolved ${hole}`);
    }

    // 6. The generated notice is there, and it did not displace a frontmatter block.
    //    Claude Code reads a subagent's name and tools from frontmatter only when the block
    //    opens the file: a notice written above it leaves the spec undispatchable and says
    //    nothing, which is the failure a marker meant to prevent hand edits would have caused.
    if (!text.includes('nina:generated')) {
      failures.push(`${rel}: composed without the nina:generated notice`);
    } else if (text.split('\n').findIndex((l) => /^(<!--|\/\/) nina:generated/.test(l)) >= NOTICE_HEAD) {
      // The edit guard reads only a file's head for the notice: one below it guards nothing.
      failures.push(`${rel}: the nina:generated notice sits below line ${NOTICE_HEAD}, out of the edit guard's reach`);
    }
    if (rel.startsWith(join('.claude', 'agents') + sep) && !text.startsWith('---\n')) {
      failures.push(`${rel}: agent spec does not open with frontmatter — it cannot be dispatched`);
    }

    // Same hazard one file type over: a `#!` line that is not at byte 0 is a comment, and the
    // script stops being executable by the hook that runs it every turn.
    if (/\.(mjs|cjs|js)$/.test(rel) && !text.startsWith('#!')) {
      failures.push(`${rel}: composed script does not open with its shebang`);
    }

    // 9. A numbered list counts 1, 2, 3. Surfaces add items to lists the core starts, so a number
    //    written in one layer cannot know its neighbours in every profile: the router's rules began
    //    at 2 in a project with no surface, and the architect's outputs ran …, 9, 11b, 15. The hard
    //    rules are the exception — other documents cite them as `Hard Rule #N`, so a rule a profile
    //    lacks leaves a gap by design, and the composed list says so.
    if (rel.endsWith('.md')) {
      for (const gap of numberingGaps(text)) failures.push(`${rel}: ${gap}`);
    }

    // 3. Nothing from an undeclared surface leaks in.
    for (const word of expect.deny ?? []) {
      const line = text.split('\n').findIndex((l) => l.includes(word));
      if (line >= 0) failures.push(`${rel}:${line + 1}: denied word "${word}"`);
    }
  }

  // 4. Surface-gated files appear, or do not, as expected.
  // 8. The pipeline graph holds for this profile. Checked against what was composed rather than
  //    against the layers, because which stages exist is exactly what the profile decides.
  const agentsDir = join(work, '.claude', 'agents');
  const specs = new Map();
  for (const file of (await readdir(agentsDir).catch(() => [])).filter((f) => f.endsWith('.md'))) {
    specs.set(file.replace(/\.md$/, ''), await readFile(join(agentsDir, file), 'utf8'));
  }
  const graphText = await readFile(join(work, '.claude', 'graph.md'), 'utf8').catch(() => null);
  if (graphText === null) failures.push('.claude/graph.md was not composed');
  else {
    const roles = new Set(
      (await readdir(join(ROOT, 'core', 'tree', '.claude', 'agents'))).map((f) => f.replace(/\.md$/, '')),
    );
    for (const problem of validateGraph(parseGraph(graphText), specs, roles)) failures.push(`graph: ${problem}`);
  }
  // 7. The frontmatter says who the agent is, when to use it, and what it may touch. Opening with `---`
  //    is not enough: the reviewer's whole `tools:` line was supplied by the frontend surface, so every
  //    profile without a frontend composed a reviewer with no allowlist at all — which Claude Code reads
  //    as "every tool", Edit and Write included, on the one role whose spec says it is read-only. And
  //    `description:` went unasked while seven roles left it to the project: these fixtures, which fill
  //    no project slot, composed a reviewer Claude Code would not load, and passed.
  for (const finding of frontmatterFindings(specs)) failures.push(`frontmatter: ${finding}`);
  // Having a `tools:` line is not the same as it granting what the spec asks for — `Skill` was missing
  // from every role while the specs made skills mandatory.
  for (const finding of toolFindings(specs, null)) failures.push(`tools: ${finding}`);
  for (const finding of modelFindings(specs)) failures.push(`model: ${finding}`);

  for (const rel of expect.present ?? []) {
    if (!existsSync(join(work, rel))) failures.push(`expected ${rel} to be composed`);
  }
  for (const rel of expect.absent ?? []) {
    if (existsSync(join(work, rel))) failures.push(`expected ${rel} NOT to be composed`);
  }

  if (verbose) {
    console.log(`  ${name}: ${composed.length} file(s), ${result.skipped.length} gated out, ${result.unfilled.length} project slot(s) to fill`);
  }
  return failures;
}


/**
 * The most characters each composed document may hold, in the largest profile a fixture composes: the
 * size measured when budgets were introduced, with about a tenth of room. Raising one is allowed and is
 * the point — it is written in the commit that needs it, where a reviewer sees the context grow. The
 * fixtures have empty project layers, so this bounds the harness's own share of each file; a project's
 * fragments come on top. Only documents are budgeted: they are what a dispatch reads.
 */
const BUDGETS = {
  '.claude/agents-overview.md': 6000,
  '.claude/agents/architect.md': 14500,
  '.claude/agents/dba.md': 12500,
  '.claude/agents/devops.md': 11500,
  '.claude/agents/implementer.md': 17000,
  '.claude/agents/integration-tester.md': 15500,
  '.claude/agents/planner.md': 10500,
  '.claude/agents/qa.md': 12500,
  '.claude/agents/reviewer.md': 20000,
  '.claude/agents/secops.md': 12500,
  '.claude/agents/solidity-auditor.md': 9000,
  '.claude/agents/solidity-dev.md': 8500,
  '.claude/graph.md': 6500,
  '.claude/patterns.md': 20000,
  '.claude/pills/README.md': 10000,
  '.claude/pipeline.md': 9500,
  '.claude/retrieval.md': 10500,
  '.claude/router.md': 16000,
  '.claude/templates/integration.md': 3000,
  'CLAUDE.md': 25000,
};

/**
 * The numbered lists in a composed document that do not count 1, 2, 3 — one line per list. A `1.`
 * starts a new list, a heading closes one, and fenced code is not prose. The hard rules are skipped:
 * their numbers are ids.
 *
 * @param {string} text - A composed markdown file.
 * @returns {string[]}
 */
function numberingGaps(text) {
  const gaps = [];
  let section = '';
  let list = [];
  let fenced = false;
  const close = () => {
    const expected = list.map((_, i) => String(i + 1)).join();
    if (list.length > 0 && list.join() !== expected && !/^Hard rules/.test(section)) {
      gaps.push(`the numbered list under "${section.slice(0, 40)}" composes as ${list.join(', ')}`);
    }
    list = [];
  };
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^#{1,6} /.test(line)) {
      close();
      section = line.replace(/^#+ /, '');
      continue;
    }
    const item = /^(\d+[a-z]?)\. /.exec(line);
    if (!item) continue;
    if (item[1] === '1') close();
    list.push(item[1]);
  }
  close();
  return gaps;
}

/**
 * A surface's technology may be named only inside that surface, or in a core file gated on it.
 *
 * This is checked against the layers rather than against a fixture's output, for two reasons. A
 * fixture only proves what its own profile composes, so a leak into a file that fixture does not
 * reach goes unseen; and a deny list matches substrings, which makes a word like `Hono`
 * unusable — it fires on `Honor`. Reading the layers asks the question once, of everything.
 */
const SURFACE_TERMS = {
  db: ['Prisma', 'Accelerate', 'Postgres', 'dba', 'DBA'],
  'edge-cf': ['wrangler', 'Cloudflare', 'Miniflare', 'workerd', 'Durable Object', 'Hono', 'Pages', 'Worker', 'Workers', 'Wrangler'],
  integrations: ['integration-tester', 'INTEGRATION-TESTER'],
  frontend: ['Playwright', 'playwright'],
  // A domain, not a technology, but the same leak: a project with no money read that under-gating a
  // money movement was a protocol violation, and that a production deploy moves real money.
  money: ['money', 'Money', 'payout', 'Payout', 'escrow', 'Escrow'],
  blockchain: ['solidity-dev', 'solidity-auditor', 'Solidity', 'OpenZeppelin', 'Foundry', 'Hardhat', 'Ethereum', 'EVM', 'ERC20', 'ERC721', 'ERC1155', 'ERC-20', 'ERC-721', 'delegatecall', 'selfdestruct'],
};

/**
 * Whether a line names a term, rather than merely containing its letters.
 *
 * `Hono` is inside `Honor`, so a plain substring test reports the word every time a rule says
 * "honor the planner's grouping". A following lower-case letter means the match is part of a
 * longer word, and so does a letter or digit before it — `maxWorkers` is a vitest option, not the
 * edge runtime; anything else — a space, a dot, a backtick, an apostrophe — is the term itself.
 *
 * @param {string} line - The line to search.
 * @param {string} term - The technology name.
 * @returns {boolean}
 */
function names(line, term) {
  for (let i = line.indexOf(term); i !== -1; i = line.indexOf(term, i + 1)) {
    if (!/[a-z]/.test(line[i + term.length] ?? '') && !/[A-Za-z0-9]/.test(line[i - 1] ?? '')) return true;
  }
  return false;
}

/**
 * Every place a core file names a surface it is not gated on.
 *
 * @returns {Promise<string[]>} One line per leak.
 */
async function surfaceLeaks() {
  const found = [];

  /**
   * Every layer to audit: the core, gated or not, and each surface as its own owner. The core's defaults
   * for project slots compose into every project the core file does, so they answer to that file's gate.
   */
  const layers = [
    { dir: join(ROOT, 'core', 'tree'), owner: null, label: 'core' },
    { dir: defaultsTree(ROOT), owner: null, label: 'core defaults', gatedAs: join(ROOT, 'core', 'tree') },
  ];
  for (const entry of await readdir(join(ROOT, 'surfaces'), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      layers.push({ dir: join(ROOT, 'surfaces', entry.name, 'tree'), owner: entry.name, label: entry.name });
    }
  }

  for (const layer of layers) {
    for (const rel of await walk(layer.dir)) {
      const raw = await readFile(join(layer.dir, rel), 'utf8');
      // A slot inside a history passage is composed and then stripped with it: the project's text for
      // it disappears, while the notice and `where` still offer the slot to fill.
      for (const passage of raw.match(/<!-- nina:why -->[\s\S]*?<!-- \/nina:why -->/g) ?? []) {
        if (passage.includes('nina:slot')) found.push(`${layer.label}/${rel}: a nina:why passage holds a slot, which would compose to nothing`);
      }
      // What a project composes is what is audited: history kept in the layers is not composed.
      const text = stripWhy(raw, { keepLines: true });
      // A core file may name what it is gated on. A surface file owns its own technology, and
      // nothing else: `surfaces/edge-cf` naming Prisma composes a sentence about the database
      // into a project that declared no database, which is the guarantee this repo makes in
      // its first paragraph. Reading only the core missed that whole direction.
      const gated = layer.gatedAs ? await readFile(join(layer.gatedAs, rel), 'utf8').catch(() => '') : text;
      const owner = layer.owner ?? (REQUIRES.exec(gated)?.[1] ?? null);
      // A slot or a gate names its surface by design (`nina:slot money.1`); only the prose around it counts.
      const lines = text.split('\n').map((line) => line.replace(/<!-- nina:(?:slot|requires) [^>]*-->/g, ''));
      for (const [surface, terms] of Object.entries(SURFACE_TERMS)) {
        if (owner === surface) continue;
        for (const term of terms) {
          lines.forEach((line, i) => {
            if (names(line, term)) {
              found.push(`${layer.label}/${rel}:${i + 1} names "${term}", which belongs to the ${surface} surface`);
            }
          });
        }
      }
    }
  }
  return found;
}

/**
 * Every default the core keeps for a project slot that is not one: a default for a slot the core file
 * does not have composes nowhere, and one for a surface's slot would fill it in a project that never
 * declared the surface.
 *
 * @returns {Promise<string[]>}
 */
async function defaultProblems() {
  const found = [];
  const tree = defaultsTree(ROOT);
  for (const rel of await walk(tree)) {
    const core = await readFile(join(ROOT, 'core', 'tree', rel), 'utf8').catch(() => null);
    if (core === null) {
      found.push(`core/defaults/tree/${rel}: no core file at that path`);
      continue;
    }
    const slots = new Set(core.split('\n').map((l) => SLOT.exec(l)?.[1]).filter(Boolean));
    for (const line of (await readFile(join(tree, rel), 'utf8')).split('\n')) {
      const id = SLOT.exec(line)?.[1];
      if (!id) continue;
      if (!id.startsWith('project.')) found.push(`core/defaults/tree/${rel}: ${id} is a surface's slot — a default is for a project slot`);
      else if (!slots.has(id)) found.push(`core/defaults/tree/${rel}: ${id} is not a slot of core/tree/${rel}`);
    }
  }
  return found;
}

const fixtures = (await readdir(join(ROOT, 'fixtures'), { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

let failed = 0;
for (const name of fixtures) {
  const failures = await runFixture(name);
  if (failures.length === 0) {
    console.log(`  ✓ ${name}`);
    continue;
  }
  failed += 1;
  console.log(`  ✗ ${name} — ${failures.length} failure(s)`);
  for (const f of failures.slice(0, Number(process.env.NINA_MAX ?? 25))) console.log(`      ${f}`);
  if (failures.length > Number(process.env.NINA_MAX ?? 25)) console.log(`      … and ${failures.length - 25} more`);
}

console.log(failed === 0 ? `compose fixtures: ${fixtures.length} ok` : `compose fixtures: ${failed} failing`);

const leaks = await surfaceLeaks();
if (leaks.length === 0) {
  console.log('surface leaks: none — no layer names a technology or domain it does not own');
} else {
  failed += 1;
  console.log(`surface leaks: ${leaks.length}`);
  for (const l of leaks.slice(0, Number(process.env.NINA_MAX ?? 25))) console.log(`      ${l}`);
  if (leaks.length > Number(process.env.NINA_MAX ?? 25)) console.log(`      … and ${leaks.length - 25} more`);
}

const defaulted = await defaultProblems();
if (defaulted.length === 0) {
  console.log('slot defaults: every one fills a project slot of the core file at its path');
} else {
  failed += 1;
  console.log(`slot defaults: ${defaulted.length} problem(s)`);
  for (const d of defaulted) console.log(`      ${d}`);
}

// The harness's answers to project requests travel in every release, and an upgrade tells a project
// its rule now lives at the path an answer names. A path that does not exist would send the project
// looking for a rule that is not there, and close its request on the strength of it.
const answerProblems = [];
let given = {};
try {
  given = await answers(ROOT);
} catch (error) {
  answerProblems.push(`${ANSWERED} is not valid JSON — ${error.message}`);
}
for (const [id, a] of Object.entries(given)) {
  if (a?.in !== undefined) {
    if (!/^(?:core|surfaces\/[^/]+)\/tree\/./.test(a.in) || !existsSync(join(ROOT, a.in))) answerProblems.push(`${id}: "in" names ${a.in}, which is not a layer file`);
  } else if (typeof a?.declined !== 'string' || !a.declined.trim()) {
    answerProblems.push(`${id}: neither "in" (where the rule lives) nor "declined" (why it does not)`);
  }
}
if (answerProblems.length === 0) {
  console.log(`request answers: ${Object.keys(given).length} — every one names a layer file or a reason`);
} else {
  failed += 1;
  console.log(`request answers: ${answerProblems.length} problem(s)`);
  for (const p of answerProblems) console.log(`      ${p}`);
}

process.exit(failed === 0 ? 0 : 1);
