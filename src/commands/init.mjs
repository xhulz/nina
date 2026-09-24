/**
 * `nina init` — starts a project's harness: a profile, and the list of what only the
 * project can say.
 *
 * It deliberately does NOT write stub fragments. A stub is a filled slot as far as every
 * tool is concerned, so a tree full of TODOs would compose and check clean while saying
 * nothing — which is the failure mode this harness exists to remove. Instead `init` leaves
 * the project layer empty and writes the checklist: `compose` then reports every unfilled
 * slot, honestly, until the work is actually done.
 *
 * The vocabulary is derived rather than guessed: whatever `{{PLACEHOLDER}}` the chosen core
 * and surfaces actually reference is what this project must define, and nothing else.
 */

import { createInterface } from 'node:readline/promises';
import { HARNESS } from '../paths.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { applyWiring, missingWiring, shippedScripts } from '../wiring.mjs';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REQUIRES, SLOT, byVersion, composeProject, composedPaths, layerRootFor, walk } from './compose.mjs';
import { owedDocuments } from './check.mjs';
import { defaultVocabulary } from '../vocabulary.mjs';
import { PINK, useColor } from '../banner.mjs';

/** Surfaces a repository reveals by its files. The rest are claims about the domain. */
const DETECTABLE = [
  { surface: 'db', why: 'a Prisma schema', test: (f) => f.some((p) => p.endsWith('schema.prisma')) },
  { surface: 'edge-cf', why: 'a wrangler config', test: (f) => f.some((p) => /(^|\/)wrangler\.(toml|jsonc?)$/.test(p)) },
  { surface: 'frontend', why: 'a Vite config', test: (f) => f.some((p) => /(^|\/)vite\.config\.[cm]?[jt]s$/.test(p)) },
  { surface: 'blockchain', why: 'a Foundry or Hardhat config', test: (f) => f.some((p) => /(^|\/)(foundry\.toml|hardhat\.config\.[cm]?[jt]s)$/.test(p)) },
];

/**
 * The question each surface answers. Detection can confirm three of them from files; all
 * six are really answers about what the project IS, which is why an empty repository has to
 * be asked rather than scanned.
 */
const QUESTIONS = {
  // A release is immutable, so an old core can offer a surface that was later renamed or
  // dropped. The interview has to keep working against it rather than ask an empty question.
  'external-api': 'Does it depend on anything whose behavior it does not define?',
  db: 'Does it own persistent data of its own?',
  money: 'Does it conserve and distribute an amount — money in equals money out plus retained?',
  pii: 'Does it hold data about people that would harm someone specific if it leaked?',
  integrations: 'Does it depend on anything whose behavior it does not define?',
  frontend: 'Does it render a screen a person looks at?',
  'edge-cf': 'Does it run on Cloudflare Workers or Pages?',
  // Not "does it use blockchain" — that is a technology, and a technology is not a reason to
  // gate anything. What this surface costs is immutability: code that ships cannot be edited.
  blockchain: 'Does it deploy code that cannot be changed once it is live?',
};

/**
 * The question a surface answers, or a plain one when the core is older than the map.
 *
 * @param {string} surface
 * @returns {string}
 */
function questionFor(surface) {
  return QUESTIONS[surface] ?? `Does this project have a "${surface}" surface?`;
}

/**
 * The order the interview asks in: the surfaces most projects have first, the rare ones last. Asked
 * alphabetically, the first question a web app met was whether it deploys immutable code.
 */
const ASK_ORDER = ['db', 'frontend', 'integrations', 'pii', 'money', 'edge-cf', 'blockchain'];

/**
 * The surfaces a core offers, in the order the interview asks them; one it does not know goes last.
 *
 * @param {string[]} available
 * @returns {string[]}
 */
export function askOrder(available) {
  const rank = (s) => (ASK_ORDER.includes(s) ? ASK_ORDER.indexOf(s) : ASK_ORDER.length);
  return [...available].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The interview's colors — the banner's pink, on a terminal that takes color, and plain everywhere else. */
const tint = (code, text) => (useColor() ? `\x1b[${code}m${text}\x1b[0m` : text);
const strong = (text) => tint(`1;38;2;${PINK.join(';')}`, text);
const faint = (text) => tint('2', text);
const found = (text) => tint('32', text);

/**
 * What declaring a surface actually adds, counted from the layer rather than described.
 *
 * Choosing a surface is the whole design conversation, and "declare money if you move
 * money" is not enough to choose on — it says nothing about what arrives. This counts it.
 *
 * @param {string} layerRoot - Where the surfaces are read from.
 * @param {string} surface - The surface to measure.
 * @returns {Promise<{fragments: number, files: number, rules: number, agents: string[]}>}
 */
async function surfaceImpact(layerRoot, surface) {
  const tree = join(layerRoot, 'surfaces', surface, 'tree');
  let fragments = 0;
  let rules = 0;
  const agents = [];
  const files = await walk(tree);
  for (const rel of files) {
    const text = await readFile(join(tree, rel), 'utf8');
    const n = [...text.matchAll(/^<!-- nina:slot /gm)].length;
    fragments += n;
    if (rel === 'CLAUDE.md') rules = [...text.matchAll(/^\d+\. \*\*/gm)].length;
    if (rel.includes('/agents/')) agents.push(rel.replace(/.*\/agents\//, '').replace('.md', ''));
  }

  // An agent can exist ONLY because of a surface, and then it is a core file gated on that
  // surface rather than a file in the surface's tree. Reading the tree alone under-reports
  // what declaring the surface adds — a whole role would be missing from the one number this
  // report exists to give.
  const coreAgents = join(layerRoot, 'core', 'tree', '.claude', 'agents');
  const roles = [];
  for (const rel of await walk(coreAgents)) {
    const text = await readFile(join(coreAgents, rel), 'utf8');
    if (REQUIRES.exec(text)?.[1] === surface) roles.push(rel.replace('.md', ''));
  }

  // A role the surface CREATES is not the same offer as an agent it edits, and a surface
  // supplies fragments for its own roles too — so they would otherwise be counted as edits
  // to something the project already had.
  // A surface also carries fragments for roles ANOTHER surface creates — money has text for
  // `dba` and for the solidity pair. Those compose only when that other surface is declared
  // too, so counting them here tells someone weighing `money` alone about changes they would
  // not get. They are dropped rather than explained: the number is a cost estimate, and an
  // estimate that overstates is worse than one that is silent.
  const gated = new Set();
  for (const rel of await walk(coreAgents)) {
    const text = await readFile(join(coreAgents, rel), 'utf8');
    const gate = REQUIRES.exec(text)?.[1];
    if (gate && gate !== surface) gated.add(rel.replace('.md', ''));
  }

  return {
    fragments,
    files: files.length,
    rules,
    roles: roles.sort(),
    agents: agents.filter((a) => !roles.includes(a) && !gated.has(a)).sort(),
  };
}

/**
 * Every layer file that applies to a project with these surfaces.
 *
 * @param {string} root - The NINA install directory.
 * @param {string[]} surfaces - The declared surfaces.
 * @returns {Promise<{rel: string, core: string, fragments: string[]}[]>}
 */
async function applicableFiles(root, surfaces) {
  const coreTree = join(root, 'core', 'tree');
  const out = [];
  for (const rel of (await walk(coreTree)).sort()) {
    const core = await readFile(join(coreTree, rel), 'utf8');
    const requires = REQUIRES.exec(core);
    if (requires && !surfaces.includes(requires[1])) continue;
    const fragments = [];
    for (const s of surfaces) {
      const text = await readFile(join(root, 'surfaces', s, 'tree', rel), 'utf8').catch(() => null);
      if (text !== null) fragments.push(text);
    }
    out.push({ rel, core: requires ? core.slice(requires[0].length) : core, fragments });
  }
  return out;
}

/**
 * Reads the interview's answers, from a person or from a pipe.
 *
 * `readline/promises` against a pipe does not settle its second question here, which is a
 * good reason to have one code path and two ways of getting a line rather than two flows:
 * the piped one is the only one that can be tested, so it had better be the same interview.
 *
 * @returns {Promise<{next: (prompt: string) => Promise<string>, close: () => void}>}
 */
async function lineReader() {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return { next: (prompt) => rl.question(prompt), close: () => rl.close() };
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const lines = chunks.join('').split('\n');
  let i = 0;
  return {
    next: async (prompt) => {
      const line = lines[i] === undefined ? '' : lines[i];
      i += 1;
      // Echo it, so a scripted run reads back like the conversation it stands in for.
      process.stdout.write(`${prompt}${line}\n`);
      return line;
    },
    close: () => {},
  };
}

/**
 * Asks what the project is, and which surfaces that makes true.
 *
 * The questions come first because a surface is an answer about what the thing IS, and the
 * scope description is the raw material for everything a person later has to write into the
 * project layer. Asking at setup costs one minute; reconstructing it from the code three
 * months later costs an afternoon and gets it slightly wrong.
 *
 * @param {string[]} available - The surfaces the pinned core offers.
 * @param {{surface: string, why: string}[]} matched - The surfaces the files already confirm, and by what.
 * @param {Record<string, {fragments: number, rules: number, agents: string[]}>} impacts
 * @returns {Promise<{scope: string, surfaces: string[]}>}
 */
async function interview(available, matched, impacts) {
  const rl = await lineReader();
  try {
    console.log('  Describe the scope of your project. What is it for, who uses it, what does it');
    console.log('  move or hold? A few sentences. Finish with an empty line.\n');
    const lines = [];
    for (;;) {
      const line = await rl.next('  > ');
      if (!line.trim()) break;
      lines.push(line.trim());
    }
    const scope = lines.join(' ');

    const order = available;
    console.log(`\n  ${strong('Surfaces')} — ${order.length} yes-or-no questions, one per surface.`);
    console.log('  A surface is a part of the harness only some projects need: its rules, its checks, sometimes a');
    console.log('  whole role. Answer for what the project does today; one can be added later in .nina/profile.json.\n');
    const surfaces = [];
    for (const [n, s] of order.entries()) {
      const i = impacts[s];
      const reason = matched.find((d) => d.surface === s)?.why;
      // What a yes brings, in what a person would recognise: roles, rules, agents. The count of
      // fragments is how the harness measures it, and says nothing to someone choosing.
      const brings = [
        ...(i.roles.length ? [`the ${i.roles.join(' and ')} role${i.roles.length > 1 ? 's' : ''}`] : []),
        ...(i.rules ? [`${i.rules} hard rule${i.rules > 1 ? 's' : ''}`] : []),
        ...(i.agents.length ? [`changes to ${i.agents.length} agent${i.agents.length > 1 ? 's' : ''}`] : []),
      ];
      console.log(`  ${faint(`${n + 1}/${order.length}`)}  ${strong(s)}`);
      console.log(`       ${questionFor(s)}`);
      console.log(faint(`       if yes: ${brings.length ? brings.join(' · ') : `guidance in ${i.fragments} places`}`));
      if (reason) console.log(found(`       already here: ${reason}`));
      const answer = (await rl.next(`       ${reason ? `${strong('Y')}/n` : `y/${strong('N')}`} › `)).trim().toLowerCase();
      const yes = answer === '' ? Boolean(reason) : answer.startsWith('y') || answer.startsWith('s');
      if (yes) surfaces.push(s);
      console.log('');
    }
    return { scope, surfaces };
  } finally {
    rl.close();
  }
}

/**
 * `nina init`.
 *
 * @param {string[]} argv - Command arguments.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function init(argv, ctx) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const target = resolve(arg('--project') ?? '.');
  const harness = join(target, HARNESS);

  if (existsSync(join(harness, 'profile.json')) && !argv.includes('--force')) {
    console.error(`  ${target} already has a .nina/profile.json — pass --force to start over.\n`);
    return 1;
  }

  const tree = await walk(target);
  // Kept as the matched entries, not just their names: the summary prints WHY each surface was
  // detected, and a name cannot answer that. `detected` stays a string list because the
  // interview and the profile both want names.
  const matched = DETECTABLE.filter((d) => d.test(tree));
  const detected = matched.map((d) => d.surface);
  const asked = arg('--surfaces');
  let surfaces = asked ? asked.split(',').map((s) => s.trim()).filter(Boolean) : detected;
  let scope = '';

  const releases = (await readdir(join(ctx.root, 'releases'), { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byVersion);
  const core = arg('--core') ?? releases.at(-1) ?? 'dev';
  const resolved = layerRootFor(ctx.root, core);
  if (resolved.error) {
    console.error(`  ${resolved.error}\n`);
    return 1;
  }

  // Everything below is read from the version this profile will pin — the surfaces that
  // exist, what each one costs, and the slots to fill — so the checklist describes the
  // harness the project is actually going to compose, not whatever the working tree says.
  // In the order the interview asks them, so the TODO, the brief and the hints list them as it did.
  const available = askOrder(
    (await readdir(join(resolved.dir, 'surfaces'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name),
  );
  const unknown = surfaces.filter((s) => !available.includes(s));
  if (unknown.length > 0) {
    console.error(`  core ${core} has no surface: ${unknown.join(', ')} — it has ${available.join(', ')}\n`);
    return 1;
  }

  const impacts = Object.fromEntries(
    await Promise.all(available.map(async (s) => [s, await surfaceImpact(resolved.dir, s)])),
  );

  // Ask when there is a person to ask. Piped or scripted, the questions still get written
  // down — they are in TODO.md § Surfaces either way, so nothing depends on a terminal.
  const canAsk = !asked && (process.stdin.isTTY || argv.includes('--ask')) && !argv.includes('--no-ask');
  if (canAsk) {
    const answers = await interview(available, matched, impacts);
    scope = answers.scope;
    surfaces = answers.surfaces;
  }

  const files = await applicableFiles(resolved.dir, surfaces);

  /** Every placeholder the chosen layers actually reference. */
  const vocabulary = new Set();
  /** Every project slot, with where it lands and what surrounds it. */
  const slots = [];
  for (const { rel, core, fragments } of files) {
    const lines = core.split('\n');
    for (const [, name] of [core, ...fragments].join('\n').matchAll(/\{\{([A-Z_]+)\}\}/g)) {
      vocabulary.add(name);
    }
    /** The nearest non-empty neighbour, naming it when it is another slot. */
    const neighbour = (candidates) => {
      const line = candidates.find((l) => l.trim());
      if (line === undefined) return null;
      const marker = SLOT.exec(line);
      return marker ? `slot \`${marker[1]}\`` : line.trim();
    };

    lines.forEach((line, i) => {
      const marker = SLOT.exec(line);
      if (!marker || !marker[1].startsWith('project.')) return;
      slots.push({
        rel,
        slot: marker[1],
        label: marker[2] || null,
        before: neighbour(lines.slice(0, i).reverse()) ?? '(start of file)',
        after: neighbour(lines.slice(i + 1)) ?? '(end of file)',
      });
    });
  }

  // A name the release supplies a default for is not asked: it composes as the default until the
  // project declares it, and the TODO says what the default is so a project on another stack can.
  const defaults = defaultVocabulary(resolved.dir);
  const defaulted = [...vocabulary].filter((name) => name in defaults).sort();
  for (const name of defaulted) vocabulary.delete(name);

  const profile = {
    core,
    surfaces,
    ...(surfaces.includes('integrations') ? { integrations: [] } : {}),
    vocabulary: Object.fromEntries([...vocabulary].sort().map((name) => [name, null])),
  };

  await mkdir(join(harness, 'project', 'tree'), { recursive: true });
  await writeFile(join(harness, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);

  // The wiring that runs the harness check. A project's settings.json and package.json carry far more
  // than the harness, so neither is ever rewritten: settings are written only where there are none,
  // and package.json only gains the scripts it lacks. Whatever cannot be written is left in TODO.md,
  // and `nina check` keeps asking for it.
  const shipped = await shippedScripts(resolved.dir, surfaces);
  const { done: wired } = await applyWiring(target, shipped, { settings: !existsSync(join(target, '.claude', 'settings.json')) });
  const unwired = await missingWiring(target, shipped);

  // Files of the project's own where the harness composes one: a CLAUDE.md or an agent spec written by
  // hand before the harness arrived — the adoption case — or a symlink, which compose would write
  // through. Composing over them would destroy them, so they hold the compose back and are named.
  const inTheWay = [];
  for (const p of await composedPaths(resolved.dir, surfaces)) {
    let entry = null;
    try {
      entry = lstatSync(join(target, p));
    } catch {
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile() || !readFileSync(join(target, p), 'utf8').includes('nina:generated')) inTheWay.push(p);
  }

  const cut = (s) => (s.length > 96 ? `${s.slice(0, 96)}…` : s);
  const owed = await owedDocuments(resolved.dir, surfaces);
  const todo = [
    `# Harness to-do for this project`,
    '',
    ...(scope ? ['**Start from `.nina/BRIEF.md`** — it says what this project is, and everything', 'below is written from it.', ''] : []),
    `Written by \`nina init\`. Nothing here is a stub to be left alone: a stub composes and checks`,
    `clean while saying nothing, so the project layer is empty until you fill it, and every tool`,
    `keeps reporting what is missing until then.`,
    '',
    `## 0. Surfaces — currently ${surfaces.length ? surfaces.join(', ') : 'none'}`,
    '',
    `A surface is an answer about what this project **is**, and each one turns on rules that`,
    `would be noise without it. Three can be confirmed from files once they exist; none can be`,
    `settled by a file before then. Change the answer in \`.nina/profile.json\` and re-run`,
    `\`nina compose\`.`,
    '',
    ...available.flatMap((s) => {
      const i = impacts[s];
      const mark = surfaces.includes(s) ? 'x' : ' ';
      return [
        `- [${mark}] **${s}** — ${questionFor(s)}`,
        `  - adds ${i.fragments} fragment(s)${i.rules ? `, ${i.rules} hard rule(s)` : ''}` +
          `${i.roles.length ? `, the ${i.roles.join(' and ')} role(s)` : ''}` +
          `${i.agents.length ? `, and changes: ${i.agents.join(', ')}` : ''}`,
      ];
    }),
    '',
    `## 1. Vocabulary — ${vocabulary.size} entries`,
    '',
    `Every name below appears in a rule the chosen core and surfaces state generically. Fill each one`,
    `in \`.nina/profile.json\`; a \`null\` leaves the placeholder standing in the composed output.`,
    '',
    ...[...vocabulary].sort().map((name) => `- [ ] \`${name}\``),
    ...(defaulted.length > 0
      ? [
          '',
          `${defaulted.length} more have a default from this release, and are declared only to change them:`,
          '',
          ...defaulted.map((name) => `- \`${name}\` — \`${defaults[name]}\``),
        ]
      : []),
    '',
    `## 2. Project fragments — ${slots.length} slots`,
    '',
    `Each slot is a hole the core leaves for something only this project can say. Create the file`,
    `under \`.nina/project/tree/\` at the SAME path as its target, put the marker on its own line,`,
    `and write the text under it.`,
    '',
    ...Object.entries(
      slots.reduce((acc, s) => ((acc[s.rel] ??= []).push(s), acc), {}),
    ).flatMap(([rel, group]) => [
      `### \`${rel}\` — ${group.length} slot(s)`,
      '',
      `> \`.nina/project/tree/${rel}\``,
      '',
      ...group.flatMap((s) => [
        `- [ ] \`${s.slot}\`${s.label ? ` — **${s.label}**` : ''}`,
        `  - after: ${cut(s.before)}`,
        `  - before: ${cut(s.after)}`,
      ]),
      '',
    ]),
    `## 3. Documents the harness reads but does not supply — ${owed.size}`,
    '',
    `These describe one system, so no layer can hold them: the project writes them. Until then the`,
    `references below point at nothing, and an agent told to read one simply finds no file.`,
    '',
    ...[...owed].sort().map(([doc, refs]) => `- [ ] \`${doc}\` — referenced ${refs} time(s)`),
    '',
    `## 4. Wiring — ${unwired.length === 0 ? 'done' : `${unwired.length} still to do`}`,
    '',
    `What runs the composed scripts: npm scripts and Claude Code hooks. \`nina init\` writes`,
    `\`.claude/settings.json\` only where there is none and never edits one that exists, so whatever`,
    `is listed here it could not write — \`nina wire --apply\` merges it. \`nina check\` asks for it until it is done.`,
    '',
    ...(unwired.length === 0 ? ['- [x] scripts and hooks are in place'] : unwired.map((w) => `- [ ] ${w}`)),
    '',
    `## 5. Then`,
    '',
    ...(inTheWay.length > 0
      ? [
          `\`nina init\` did NOT compose: ${inTheWay.length} file(s) of this project's own sit where the harness composes one,`,
          `and composing would have destroyed them. Move each aside — or into \`.nina/project/tree/\` as the fragment`,
          `that fills its slot — and then run \`nina compose\`:`,
          '',
          ...inTheWay.map((p) => `- [ ] \`${p}\``),
          '',
        ]
      : [
          `\`nina init\` has already composed the harness — holes and all — so its hooks run from the first`,
          `session in this project, and before every answer the model is told what is still missing here: this`,
          `list, and ${scope ? '`.nina/BRIEF.md` for what the project is' : 'whatever it needs to ask about what the project is'}. Fill §0–§3, then:`,
          '',
        ]),
    '```bash',
    `nina compose --project .     # writes CLAUDE.md and .claude/ again, with the holes filled`,
    `nina check                   # names whatever is still missing`,
    '```',
    '',
  ].join('\n');
  await writeFile(join(harness, 'TODO.md'), todo);

  if (scope) {
    await writeFile(
      join(harness, 'BRIEF.md'),
      [
        '# Project brief',
        '',
        'What this project is, in the words of whoever started it, captured by `nina init`.',
        '',
        '**This is the input, not a record.** Everything the harness cannot state generically is',
        'written from here:',
        '',
        '- the **mission** and **stack** sections of `CLAUDE.md`, and every role introduction —',
        '  the `project.*` slots listed in `.nina/TODO.md`',
        '- which **integrations** this project has, their `kind`, and the boundary each one gets',
        '  — then a doc per integration from `.claude/templates/integration.md`',
        '- the first **specs**, and what belongs in `.claude/architecture.md`: the state machines,',
        '  the privacy categories, the layering this project actually uses',
        '',
        'Read it before filling anything. If it is thin, ask for more rather than inventing:',
        'a mission written from a guess is a mission every agent will quote back at you.',
        '',
        ...scope.split('. ').map((sentence) => `> ${sentence.trim()}${sentence.endsWith('.') ? '' : '.'}`),
        '',
        '## Surfaces chosen at setup',
        '',
        ...available.map((s) => `- [${surfaces.includes(s) ? 'x' : ' '}] **${s}** — ${questionFor(s)}`),
        '',
      ].join('\n'),
    );
  }

  console.log(`  initialised ${target}\n`);
  if (!asked && !canAsk) {
    const greenfield = tree.filter((f) => !f.startsWith('.git') && !f.startsWith(HARNESS)).length === 0;
    if (greenfield) {
      console.log('    this directory is empty, so there is nothing to detect — and nothing to');
      console.log('    detect is the normal case at the start. Answer the questions in');
      console.log('    .nina/TODO.md § Surfaces, then re-run with --surfaces and --force.\n');
    } else {
      for (const d of matched) console.log(`    detected ${d.surface.padEnd(13)} ${d.why}`);
      if (detected.length === 0) console.log('    detected no surface from the files present');
      console.log('');
      // From the surfaces this core HAS, not from the question map. The map keeps entries for
      // surfaces that were later renamed or dropped, so that an old pinned release still asks
      // its own questions — suggesting one of those here offers a surface that cannot be
      // declared, and `--surfaces` would then refuse it.
      for (const name of available) {
        if (surfaces.includes(name) || detected.includes(name)) continue;
        console.log(`    consider ${name.padEnd(13)} ${questionFor(name)}`);
      }
      console.log('\n    no file can settle those — add them with --surfaces and re-run with --force.\n');
    }
  }
  // Composed now, holes and all, so the hooks just wired have something to run from the first session:
  // the model is told what is missing before its first answer, instead of someone remembering to ask it.
  let composed = { written: [] };
  if (inTheWay.length === 0) {
    try {
      composed = await composeProject(target, ctx);
    } catch (error) {
      composed = { error: error.message, written: [] };
    }
  }

  for (const w of wired) console.log(`    wired      ${w}`);
  for (const w of unwired) console.log(`    to wire    ${w}`);
  if (wired.length || unwired.length) console.log('');
  console.log(`    surfaces:  ${surfaces.join(', ') || '(none)'}`);
  console.log(`    core:      ${profile.core}`);
  console.log(`    to fill:   ${vocabulary.size} vocabulary entries, ${slots.length} project slots, ${owed.size} document(s)`);
  if (inTheWay.length > 0) {
    console.log(`    composed:  nothing — ${inTheWay.length} file(s) of yours sit where the harness composes one, and would be lost:`);
    for (const p of inTheWay) console.log(`                 ${p}`);
    console.log('               move them aside, or into .nina/project/tree/ as fragments, then `nina compose` (TODO.md §5)');
  } else {
    console.log(
      composed.error
        ? `    composed:  nothing — ${composed.error}`
        : `    composed:  ${composed.written.length} file(s), with holes where .nina/TODO.md §1–§3 go`,
    );
  }
  const uninstalled = unwired.some((w) => w.startsWith('@xhulz/nina is not installed'));
  if (uninstalled) {
    console.log('    first:     install @xhulz/nina here — until then no hook can load, and nothing tells the model anything');
  }
  console.log(
    `    next:      ${uninstalled || inTheWay.length > 0 ? 'then ' : ''}open Claude Code here — before its first answer it is told what this project still lacks` +
      (scope ? ', and .nina/BRIEF.md says what the project is\n' : '\n'),
  );
  return 0;
}
