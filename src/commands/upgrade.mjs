/**
 * `nina upgrade` — moves a project from one frozen core to another, and says what that costs
 * before it costs it.
 *
 * The dangerous part of an upgrade is not what changes in the harness; it is what the project
 * already wrote that the new harness has nowhere to put. A slot that was renamed or dropped
 * takes the project's own text out of the composition with it, silently, because a fragment
 * nothing references composes to nothing and no check notices. So this reports first and
 * writes only when told to, and what it writes is one field: the version. Reconciling the
 * fragments is work, and work does not get done by a flag.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { HARNESS, legacyHint } from '../paths.mjs';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { composeProject, composedPaths, defaultedSlots, layerRootFor } from './compose.mjs';
import { filledSlots, projectSlots, referencedVocabulary } from './check.mjs';
import { EXPECT_ENV } from '../expected.mjs';
import { closeAnswered } from './learn.mjs';
import { missingFragment, missingWiring, shippedScripts } from '../wiring.mjs';
import { runSteps } from '../steps.mjs';
import { defaultVocabulary } from '../vocabulary.mjs';

/** Banner lines, which are for a person watching and only noise inside a captured log. */
const BANNER = /^[\s█╗╔╝║═╚▄▀]*$|harness orchestration ·/;

/**
 * Everything that must still hold after the move, in the order a person would check it.
 *
 * A slot the move itself creates is not breakage: the preview names it, and it cannot be filled
 * before the core that introduces it is pinned. Rolling back for one leaves no order in which the
 * upgrade can ever complete. It is passed through so `check` reports it as work rather than as a
 * fault — everything else it finds still rolls the move back.
 *
 * @param {string} target - The project.
 * @param {string[]} newSlots - Project slots this move introduces, as `<file> <slot id>`.
 * @returns {{label: string, args: string[]}[]}
 */
function validationsFor(target, newSlots = []) {
  return [
    // Not `--quiet`: that is detector mode, which stays silent on success — and a step that
    // reports nothing where its neighbours report a summary reads as a step that did nothing.
    // The full output is only ever printed when the step fails, so the noise costs nothing.
    {
      label: 'checking the declaration',
      args: [
        'check',
        '--project',
        target,
        ...(newSlots.length > 0 ? ['--expect-unfilled', newSlots.join(',')] : []),
      ],
    },
    { label: 'validating the pills', args: ['pills', '--project', target] },
  ];
}

/**
 * Runs this same CLI against the project and captures what it said.
 *
 * Spawned rather than called in-process for one reason: a step has to be able to fail without
 * taking the upgrade's own process with it, and these commands report by printing and exiting.
 *
 * @param {{root: string}} ctx - CLI context.
 * @param {string} target - The project.
 * @param {string[]} args - The command and its arguments.
 * @returns {{ok: boolean, out: string, summary: string|undefined}}
 */
function nina(ctx, target, args) {
  const result = spawnSync(process.execPath, [join(ctx.root, 'bin', 'nina.mjs'), ...args], {
    cwd: target,
    encoding: 'utf8',
  });
  const out = [result.stdout ?? '', result.stderr ?? '']
    .join('\n')
    .split('\n')
    .filter((line) => line.trim() && !BANNER.test(line))
    .join('\n');
  return { ok: result.status === 0, out, summary: summarise(out) };
}

/**
 * Whether the project declares an npm script.
 *
 * @param {string} target - The project.
 * @param {string} script - The script name.
 * @returns {Promise<boolean>}
 */
async function declares(target, script) {
  try {
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts?.[script]);
  } catch {
    return false;
  }
}

/**
 * Runs one of the project's own npm scripts.
 *
 * Run through `sh` with the project's `node_modules/.bin` on PATH, which is what a package
 * manager does, so this does not have to know whether the project uses npm, pnpm or yarn.
 *
 * @param {string} target - The project.
 * @param {string} script - The script name.
 * @returns {{ok: boolean, out: string, summary: string|undefined}}
 */
function shell(target, script) {
  let command;
  try {
    command = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).scripts?.[script];
  } catch {
    return { ok: false, out: `could not read ${join(target, 'package.json')}`, summary: undefined };
  }
  const result = spawnSync('sh', ['-c', command], {
    cwd: target,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(target, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` },
  });
  const out = [result.stdout ?? '', result.stderr ?? ''].join('\n').split('\n').filter((l) => l.trim()).join('\n');
  return { ok: result.status === 0, out, summary: summarise(out) };
}

/**
 * What a step reported as wrong, as comparable lines: numbers masked, so a count or a version that
 * changed with the move does not read as a new problem, and each mapped back to the line as printed.
 * Notes (`·`), hints (`→`) and passes (`✓`) are not failures: a note the move itself creates — "this
 * slot is new in this core and still to fill" — is exactly what must never roll a move back.
 *
 * @param {string} out - Captured output.
 * @returns {Map<string, string>} Masked line → the line as printed.
 */
function findings(out) {
  const lines = new Map();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line || /^[·→✓]/.test(line)) continue;
    lines.set(line.replace(/\d+/g, '#'), line);
  }
  return lines;
}

/**
 * The one line a command ends on, which is what a person reads when it went well.
 *
 * @param {string} out - Captured output.
 * @returns {string|undefined}
 */
function summarise(out) {
  const lines = out.split('\n').filter((l) => l.trim());
  // Anchored at column zero: a command's closing line starts there, and every `key: value`
  // inside a stack trace is indented. Without that, a crash reports `code: ERR_…` as its summary.
  return [...lines].reverse().find((l) => /^\w[\w ]*:/.test(l))?.trim();
}

/**
 * `nina upgrade`.
 *
 * @param {string[]} argv - Command arguments; `--to <version>` names the target core.
 * @param {{root: string}} ctx - CLI context; `root` is the NINA install directory.
 * @returns {Promise<number>} Process exit code.
 */
export async function upgrade(argv, ctx) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const target = resolve(arg('--project') ?? '.');
  const apply = argv.includes('--apply');

  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    console.error(`  no .nina/profile.json under ${target}${legacyHint(target)}\n`);
    return 1;
  }
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));

  const to = arg('--to');
  if (!to) {
    console.error('  usage: nina upgrade --to <version> [--project <dir>] [--apply]\n');
    return 2;
  }
  if (to === profile.core) {
    console.log(`  ${target} already pins ${to}.\n`);
    return 0;
  }

  const from = layerRootFor(ctx.root, profile.core);
  if (from.error) {
    console.error(`  ${from.error}\n`);
    return 1;
  }
  // The release asked for is not one this install carries: the installed package is older than it. Said
  // as that, with the install that fixes it. It used to read "profile pins core <version>", about a pin the
  // profile did not hold, right after an install that had failed.
  const onto = layerRootFor(ctx.root, to);
  if (onto.error) {
    let installed = '?';
    try {
      installed = JSON.parse(await readFile(join(ctx.root, 'package.json'), 'utf8')).version;
    } catch {
      // An install with no manifest still says what to run.
    }
    console.error(
      to === 'dev'
        ? `  ${onto.error}\n`
        : `  ${to} is not a release the installed NINA (${installed}) carries — install it first: pnpm add -D -E @xhulz/nina@${to}\n`,
    );
    return 1;
  }

  const surfaces = profile.surfaces ?? [];
  const available = (await readdir(join(onto.dir, 'surfaces'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const gone = surfaces.filter((s) => !available.includes(s));
  const kept = surfaces.filter((s) => available.includes(s));

  const [vocabBefore, vocabAfter] = [
    await referencedVocabulary(from.dir, surfaces, target),
    await referencedVocabulary(onto.dir, kept, target),
  ];
  const [slotsBefore, slotsAfter] = [
    await projectSlots(from.dir, surfaces),
    await projectSlots(onto.dir, kept),
  ];
  const filled = await filledSlots(target);

  const declared = profile.vocabulary ?? {};
  // A name the new release supplies a default for is not owed: it composes as the default until declared.
  const defaultsAfter = defaultVocabulary(onto.dir);
  const needed = [...vocabAfter].filter((v) => (!(v in declared) && !(v in defaultsAfter)) || declared[v] === null).sort();
  const unused = Object.keys(declared).filter((v) => !vocabAfter.has(v)).sort();
  // A slot the new release fills itself is not asked of the project: it composes as the release wrote it.
  const defaultedAfter = await defaultedSlots(onto.dir);
  const newSlots = [...slotsAfter].filter((s) => !slotsBefore.has(s) && !filled.has(s) && !defaultedAfter.has(s)).sort();
  const stranded = [...filled].filter((s) => !slotsAfter.has(s)).sort();

  console.log(`  ${profile.core} → ${to}\n`);

  if (gone.length > 0) {
    console.log(`  ✗ ${gone.length} declared surface(s) do not exist in ${to}: ${gone.join(', ')}`);
    console.log(`      a rename cannot be guessed — pick the replacement yourself, and move the`);
    console.log(`      fragments that belonged to it before upgrading.\n`);
  }
  if (stranded.length > 0) {
    console.log(`  ✗ ${stranded.length} fragment(s) this project wrote fill slots ${to} does not have:`);
    for (const s of stranded.slice(0, 15)) console.log(`      ${s}`);
    if (stranded.length > 15) console.log(`      … and ${stranded.length - 15} more`);
    console.log(`      that text composes to nothing after the upgrade, and no check reports it.`);
    console.log(`      Re-home it, or delete it deliberately.\n`);
  }
  if (needed.length > 0) {
    console.log(`  · ${needed.length} vocabulary entr(ies) ${to} needs and this profile has not filled:`);
    console.log(`      ${needed.join(', ')}\n`);
  }
  if (unused.length > 0) {
    console.log(`  · ${unused.length} vocabulary entr(ies) nothing in ${to} references: ${unused.join(', ')}\n`);
  }
  if (newSlots.length > 0) {
    console.log(`  · ${newSlots.length} new project slot(s) to fill:`);
    for (const s of newSlots.slice(0, 15)) console.log(`      ${s}`);
    if (newSlots.length > 15) console.log(`      … and ${newSlots.length - 15} more`);
    console.log('');
  }

  // A script the new core composes for the first time is run by hooks this project does not have yet.
  // Moving without them composes a gate that never runs and a check that fails right after — and the
  // hooks can be merged first, because each one runs its script only once that script exists.
  const scriptsBefore = await shippedScripts(from.dir, surfaces);
  const newScripts = new Set([...(await shippedScripts(onto.dir, kept))].filter((s) => !scriptsBefore.has(s)));
  const unwired = newScripts.size > 0 ? await missingWiring(target, newScripts) : [];
  if (unwired.length > 0) {
    console.log(`  ✗ ${unwired.length} hook(s) or script(s) that ${to}'s new ${[...newScripts].join(', ')} need(s) are not wired:`);
    for (const w of unwired) console.log(`      ${w}`);
    const fragment = await missingFragment(target, newScripts);
    if (fragment) {
      console.log('      the hooks, to merge into .claude/settings.json:');
      for (const line of fragment.split('\n')) console.log(`        ${line}`);
    }
    console.log(`      \`nina wire --to ${to} --apply\` merges them. They stay inert until ${to} is pinned, so wiring first is safe.`);
    if (unwired.some((w) => w.startsWith('@xhulz/nina is not installed'))) {
      console.log('      The package is the one thing `wire` cannot do: `pnpm add -D -E @xhulz/nina`.');
    }
    console.log('');
  }

  // A file the project wrote itself at a path the new version starts composing would be replaced by the
  // composition — and no step reports a file that was silently overwritten. Checked without following
  // links: a symlink there is the project's too, and compose would write through it.
  const pathsBefore = await composedPaths(from.dir, surfaces);
  const pathsAfter = await composedPaths(onto.dir, kept);
  const entryAt = (p) => {
    try {
      return lstatSync(join(target, p));
    } catch {
      return null;
    }
  };
  const newPaths = [...pathsAfter].filter((p) => !pathsBefore.has(p));
  const occupied = newPaths.filter((p) => entryAt(p) && !entryAt(p).isDirectory()).sort();
  const walledOff = newPaths.filter((p) => entryAt(p)?.isDirectory()).sort();
  if (occupied.length > 0) {
    console.log(`  ✗ ${occupied.length} file(s) this project wrote sit where ${to} composes one, and would be replaced:`);
    for (const p of occupied) console.log(`      ${p}`);
    console.log(`      move them first, or pass --force — a copy goes to ${HARNESS}/replaced/, and they are put back if the move rolls back.\n`);
  }
  if (walledOff.length > 0) {
    console.log(`  ✗ ${walledOff.length} director(ies) sit where ${to} composes a file — move them; not even --force can compose over one:`);
    for (const p of walledOff) console.log(`      ${p}`);
    console.log('');
  }

  const blocking = gone.length + stranded.length + unwired.length + occupied.length + walledOff.length;
  if (!apply) {
    console.log(
      blocking > 0
        ? `  upgrade: NOT safe to apply as-is — ${blocking} thing(s) would lose meaning. Nothing was written.\n`
        : `  upgrade: safe. Re-run with --apply to pin ${to}.\n`,
    );
    return blocking > 0 ? 1 : 0;
  }
  if (walledOff.length > 0) {
    console.log(`  refusing to apply: ${walledOff.length} director(ies) sit where ${to} composes a file.\n`);
    return 1;
  }
  // Not forceable: a move without its hooks composes a script nothing runs, and one command wires them.
  // What `wire` cannot write — a project with no package.json at all — stays among what --force may accept.
  if (unwired.some((w) => w.startsWith('.claude/settings.json'))) {
    console.log(`  refusing to apply: ${to} needs hooks this project has not wired. \`nina wire --to ${to} --apply\` wires them; --force does not skip this.\n`);
    return 1;
  }
  if (blocking > 0 && !argv.includes('--force')) {
    console.log(`  refusing to apply: ${blocking} thing(s) would lose meaning. Fix them, or pass --force.\n`);
    return 1;
  }

  const previous = profile.core;
  const pin = async (version) => {
    profile.core = version;
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  };

  // What was already failing is not this upgrade's doing, and rolling back for it would blame
  // the move for a problem the project brought with it. Measured before anything is written,
  // so the only rollback is for something that WAS passing and now is not.
  const VALIDATIONS = validationsFor(target, newSlots);
  const DETECTORS = "running the project's own detectors";
  const hasDetectors = await declares(target, 'harness:check');

  // Everything that is re-run after the move, measured before it. The project's own detectors
  // belong in this list and were left out of it: `check` was excused for a problem the project
  // already had while the detector step rolled the move back for the very same problem, read
  // through a different command. One list means a step added later is measured without anyone
  // remembering to measure it.
  const rerun = [
    ...VALIDATIONS.map((v) => [v.label, () => nina(ctx, target, v.args)]),
    ...(hasDetectors ? [[DETECTORS, () => shell(target, 'harness:check')]] : []),
  ];
  // A lesson owed is a finding about the project's history, not about this move — and a version
  // that ships the lessons detector for the first time would otherwise read that history as
  // breakage and roll itself back. It is set aside for the move and reported after it. Set before
  // the baseline too: the lessons detector files requests, and a move that rolls back should not
  // leave files behind that its measurement wrote.
  process.env.NINA_UPGRADE = '1';
  const before = new Map(rerun.map(([label, run]) => [label, run()]));

  /**
   * A step that fails only because the project was already failing it is reported, not rolled
   * back for — otherwise the upgrade takes the blame for a problem it found rather than caused.
   *
   * @param {string} label - The step's name, which is also its key in the baseline.
   * @param {() => {ok: boolean, out: string, summary: string|undefined}} run - What to re-run.
   * @returns {{label: string, run: () => {ok: boolean, detail?: string, log?: string}}}
   */
  const forced = argv.includes('--force');
  /** What a forced move added to steps that were failing already — printed once the move is done. */
  const forcedAlso = [];
  const guarded = (label, run) => ({
    label,
    run: () => {
      const r = run();
      const was = before.get(label);
      if (!r.ok && was && !was.ok) {
        // Excused only for what it already said. An exit code cannot tell "the same problem" from "that
        // problem and a new one", so a step failing before the move used to be excused whole — and a
        // project missing one hook had every later breakage in that step waved through with it.
        const known = findings(was.out);
        const fresh = [...findings(r.out)].filter(([masked]) => !known.has(masked)).map(([, line]) => line);
        if (fresh.length === 0) return { ok: true, detail: 'still failing, as it was before the upgrade' };
        // Forced: the owner already accepted a move that loses meaning. Say what is new; do not undo it.
        if (forced) {
          forcedAlso.push(...fresh.map((line) => `${label}: ${line}`));
          return { ok: true, detail: `forced — failing as before, and ${fresh.length} thing(s) more, listed below` };
        }
        return { ok: false, detail: `failing as before, and now also: ${fresh[0]}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`, log: r.out };
      }
      return { ok: r.ok, detail: r.summary, log: r.out };
    },
  });

  // Every step from here on runs in a child process, and the last of them is the project's own
  // `harness:check` — an npm script whose detector list this command does not own and cannot
  // pass an argument to. The environment is what crosses that boundary, and setting it once
  // means a reporter added to the chain later is told without anyone remembering to tell it.
  if (newSlots.length > 0) process.env[EXPECT_ENV] = newSlots.join(',');

  // Compose writes and never deletes. So the files the new version stops composing are removed right
  // after it composes — before anything is verified, so what is verified is what stays — unless they
  // carry edits of the project's own; and if the move rolls back, the files it composed for the first
  // time are removed and the ones it replaced are put back. Without that, a rolled-back move left the new
  // version's loop gate on disk, run by hooks the owner had just wired for it.
  const edited = new Set(
    ((await composeProject(target, ctx, { check: true })).differ ?? []).map((d) => d.replace(/ \(present, but no '[^']*' surface\)$/, '')),
  );
  const created = newPaths.filter((p) => !entryAt(p));
  const dropped = [...pathsBefore].filter((p) => !pathsAfter.has(p) && entryAt(p));
  const removable = dropped.filter((p) => !edited.has(p));
  const keptEdited = dropped.filter((p) => edited.has(p));
  // Every file the move can touch, as it is now, so a rollback puts the tree back exactly — the
  // recompose alone would write the old composition over the owner's own edits and call it restored.
  const saved = new Map();
  for (const p of new Set([...pathsBefore, ...pathsAfter])) {
    const entry = entryAt(p);
    if (entry?.isFile()) saved.set(p, readFileSync(join(target, p)));
  }
  // And a copy of each project file the move replaces, on disk, where an interrupted move cannot lose it.
  for (const p of occupied) {
    const copy = join(target, HARNESS, 'replaced', p);
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, saved.get(p) ?? readFileSync(join(target, p)));
  }

  await pin(to);
  console.log(`  pinned ${to}\n`);

  const steps = [
    {
      label: 'composing the harness files',
      run: () => {
        // The files of the project's own that the move replaces are copied above; compose will not write
        // over one, so each goes first, and a rollback puts it back.
        for (const p of occupied) rmSync(join(target, p), { force: true });
        const r = nina(ctx, target, ['compose', '--project', target]);
        const wrote = /composed (\d+) file/.exec(r.out)?.[1];
        if (r.ok) for (const p of removable) rmSync(join(target, p), { force: true });
        const removedNote = r.ok && removable.length > 0 ? `, removed ${removable.length} no longer composed` : '';
        return { ok: r.ok, detail: wrote ? `${wrote} file(s)${removedNote}` : undefined, log: r.out };
      },
    },
    ...rerun.map(([label, run]) => guarded(label, run)),
    ...(hasDetectors ? [] : [{ label: DETECTORS, skip: true, run: () => ({ ok: true }) }]),
  ];

  const { failed } = runSteps(steps);

  if (!failed) {
    delete process.env.NINA_UPGRADE;
    console.log(`\n  upgrade: ${previous} → ${to} applied and verified.`);
    if (removable.length > 0) console.log(`\n  removed ${removable.length} file(s) ${to} no longer composes: ${removable.join(', ')}`);
    if (keptEdited.length > 0) {
      console.log(`\n  kept ${keptEdited.length} file(s) ${to} no longer composes, because they carry edits of yours — delete them once nothing in them is needed:`);
      for (const p of keptEdited) console.log(`      ${p}`);
    }
    if (occupied.length > 0) {
      console.log(`\n  replaced ${occupied.length} file(s) of yours with what ${to} composes there — the originals are in ${HARNESS}/replaced/:`);
      for (const p of occupied) console.log(`      ${p}`);
    }
    if (forcedAlso.length > 0) {
      console.log(`\n  forced — ${forcedAlso.length} thing(s) the move added to steps that were already failing:`);
      for (const line of forcedAlso) console.log(`    ${line}`);
    }
    // Before the lessons detector, which would otherwise read a pill this release just made a rule
    // as a lesson still waiting for one.
    const answered = await closeAnswered(target, onto.dir, to).catch((error) => {
      console.log(`\n  could not close the requests ${to} answers — ${error.message}. \`nina learn\` lists them.`);
      return [];
    });
    if (answered.length > 0) {
      console.log(`\n  ${answered.length} request(s) this project sent to the harness are answered in ${to}:`);
      for (const a of answered) {
        if (a.status === 'closed' && a.needs) {
          console.log(`    closed ${HARNESS}/requests/${a.file} — the rule went into the ${a.needs} surface, which this project does not declare. The pill stays active.`);
        } else if (a.status === 'closed') {
          console.log(`    closed ${HARNESS}/requests/${a.file} — the rule is now in ${a.where}${a.pill ? `; retired ${a.pill}` : ''}`);
        } else {
          console.log(`    declined ${HARNESS}/requests/${a.file} — ${a.why}. The pill stays active: it is this project's lesson.`);
        }
      }
    }
    const lessons = nina(ctx, target, ['learn', '--project', target, '--check']);
    if (!lessons.ok && lessons.out.trim()) {
      console.log('\n  the learning cycle has something to act on — not caused by this move, now visible:');
      for (const line of lessons.out.trim().split('\n')) console.log(`    ${line}`);
    }
    // The move is done and the tree is sound, but it is not finished: until these are written
    // the composed text is quietly missing what they carry, which is the failure this harness
    // exists to remove. A success line that did not say so would be the same silence.
    if (newSlots.length > 0) {
      console.log(`\n  ${newSlots.length} project slot(s) still to fill — only this project can write them:`);
      for (const s of newSlots) console.log(`      ${s}`);
    }
    console.log('');
    return 0;
  }

  console.log(`\n  ✗ ${failed.label} failed — rolling back to ${previous}.\n`);
  await pin(previous);
  for (const p of created) rmSync(join(target, p), { force: true });
  const recomposed = nina(ctx, target, ['compose', '--project', target]);
  for (const [p, bytes] of saved) {
    mkdirSync(dirname(join(target, p)), { recursive: true });
    writeFileSync(join(target, p), bytes);
  }
  console.log(
    recomposed.ok
      ? `  rolled back: pinned ${previous} and recomposed. The tree is as it was.\n`
      : `  rolled back the pin to ${previous}, but recomposing failed — run \`nina compose\` yourself.\n`,
  );
  if (failed.log.trim()) {
    console.log('  what it said:\n');
    for (const line of failed.log.trim().split('\n')) console.log(`    ${line}`);
    console.log('');
  }
  return 1;
}
