/**
 * Runs a project's harness drift detectors, keeping "the harness drifted" and "the check
 * could not run" as different answers.
 *
 * The previous Stop hook ran the detectors inline and treated any output on stderr as drift.
 * Opening a session in a directory without `scripts/` therefore printed a Node
 * `MODULE_NOT_FOUND` stack trace under the heading "harness drift", every single turn. A
 * detector that reports its own failure as the defect it exists to detect trains you to
 * ignore it, and it is one of only two automatic checks this harness has.
 *
 * This lives in the package rather than in a layer because the NINA repo cannot compose
 * itself — composing would overwrite its own `CLAUDE.md`, which is about the compiler and
 * not about a project's harness. A layer would therefore have fixed every consuming project
 * and left this repo's own copy to drift, which is the defect being fixed. The two copies had
 * already diverged: one had learned to run a detector that is a binary on PATH and the other
 * never did.
 *
 * What stays with the project is the LIST — which detectors it has, what each one is called,
 * and what to do when one fires. That is not shared knowledge, and a project is the only
 * thing that can answer it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Runs one detector.
 *
 * A detector is either a script in the project or, for one the harness CLI owns, a `bin`
 * resolved on PATH. A CLI that is not installed is `missing`, not drift: it says nothing
 * about the tree.
 *
 * @param {{name: string, declaredBy: string, script?: string, bin?: string, args: string[], ignore?: RegExp}} detector
 * @param {string} root - The project root.
 * @param {Set<string>} declared - The npm scripts the project declares.
 * @returns {{name: string, state: 'ok'|'drift'|'error'|'missing'|'n/a', detail: string}}
 */
function runOne(detector, root, declared) {
  // A detector with no `declaredBy` is one the harness ships to every project — the project has
  // nothing to opt into, and asking it to add an npm script first is how a detector ends up
  // installed and never run.
  if (detector.declaredBy && !declared.has(detector.declaredBy)) {
    return { name: detector.name, state: 'n/a', detail: 'not declared by this repo' };
  }
  const path = detector.bin ? null : join(root, detector.script);
  if (path && !existsSync(path)) {
    return { name: detector.name, state: 'missing', detail: `${detector.script} not found` };
  }

  // The project's own install first. A Stop hook runs `node scripts/harness-check.mjs` directly,
  // not through the package manager, so `node_modules/.bin` is not on PATH — and a project that
  // installed the harness the documented way, vendored, would report the harness's own detector
  // as missing on every turn.
  const local = detector.bin ? join(root, 'node_modules', '.bin', detector.bin) : null;
  const result = detector.bin
    ? spawnSync(local && existsSync(local) ? local : detector.bin, detector.args, { cwd: root, encoding: 'utf8' })
    : spawnSync(process.execPath, [path, ...detector.args], { cwd: root, encoding: 'utf8' });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      return { name: detector.name, state: 'missing', detail: `\`${detector.bin}\` is not on PATH` };
    }
    return { name: detector.name, state: 'error', detail: String(result.error.message) };
  }
  if (result.signal) {
    return { name: detector.name, state: 'error', detail: `killed by ${result.signal}` };
  }

  const stderr = (result.stderr ?? '').trim();
  const stdout = (result.stdout ?? '')
    .split('\n')
    .filter((line) => line.trim() && !detector.ignore?.test(line.trim()))
    .join('\n')
    .trim();

  // A crash inside node also exits 1, so a stack trace with no findings is a failure to
  // run, not a finding.
  if (stderr.includes('node:internal') || /^\w*Error:/m.test(stderr)) {
    return { name: detector.name, state: 'error', detail: stderr.split('\n').slice(0, 3).join('\n') };
  }
  if (result.status === 0) return { name: detector.name, state: 'ok', detail: stdout };
  if (result.status === 1) {
    return { name: detector.name, state: 'drift', detail: [stdout, stderr].filter(Boolean).join('\n') };
  }
  return { name: detector.name, state: 'error', detail: `exit ${result.status}\n${stderr || stdout}` };
}

/**
 * The npm scripts a project declares, which is how it says which detectors apply to it.
 *
 * Not every project has every detector: this repo has agent specs but no code map and no
 * premise index, and hardcoding the set made it report a missing detector on every turn —
 * noise, from the very check built to stop noise. A detector whose script the project does
 * not declare is not applicable; one that is declared and absent is a real problem, because
 * something deleted it.
 *
 * @param {string} root - The project root.
 * @returns {Set<string>}
 */
function declaredIn(root) {
  try {
    return new Set(Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * Runs every detector a project declares and reports what each one found.
 *
 * @param {{name: string, declaredBy: string, script?: string, bin?: string, args: string[], hint?: string, ignore?: RegExp}[]} detectors
 *   The detectors, in report order. Each exits 0 when current and 1 when it finds drift;
 *   anything else means it failed to run.
 * @param {{root: string, hook?: boolean, context?: boolean}} options - `root` is the project;
 *   `hook` emits a `systemMessage` for a Stop hook; `context` emits `additionalContext` for a
 *   UserPromptSubmit hook. Both never exit non-zero.
 * @returns {number} The exit code: 2 when a detector could not run, 1 on drift, else 0.
 */
export function runDetectors(detectors, options) {
  const { root, hook = false, context = false } = options;
  const declared = declaredIn(root);
  const results = detectors.map((d) => runOne(d, root, declared));
  const applicable = results.filter((r) => r.state !== 'n/a');
  const drift = results.filter((r) => r.state === 'drift');
  const errored = results.filter((r) => r.state === 'error');
  const missing = results.filter((r) => r.state === 'missing');

  const parts = [];
  if (drift.length > 0) {
    // Not every detector reports drift any more — one reports a lesson the pipeline owes — so the
    // heading says what they have in common: something here needs doing before it is forgotten.
    parts.push('⚠️  harness check — something needs acting on:');
    for (const r of drift) {
      const hint = detectors.find((d) => d.name === r.name)?.hint;
      parts.push(`  ${r.name}: ${r.detail || 'stale'}${hint ? `\n  → ${hint}` : ''}`);
    }
  }
  if (errored.length > 0) {
    parts.push('🔧 harness check could not run — this says nothing about drift:');
    for (const r of errored) parts.push(`  ${r.name}: ${r.detail}`);
  }
  // A declared detector that is absent was deleted; that is worth saying. One this repo
  // never declared simply does not apply here.
  if (missing.length > 0) {
    parts.push('🔧 harness check incomplete — a declared detector is missing:');
    for (const r of missing) parts.push(`  ${r.name}: ${r.detail}`);
  }
  if (!hook && !context && applicable.length === 0) {
    parts.push(`no detectors declared in ${join(root, 'package.json')} — nothing to check here`);
  }
  const text = parts.length > 0 ? parts.join('\n') : null;

  if (hook) {
    if (text) process.stdout.write(`${JSON.stringify({ systemMessage: text })}\n`);
    return 0;
  }

  // A Stop hook's `systemMessage` is shown to the person, never to the model — Claude Code says
  // so in as many words. Every detector here was therefore reporting to the one reader who was
  // not about to act on it: the drift, the stale map, the lesson owed all reached the human, and
  // closing the loop meant the human relaying it. A UserPromptSubmit hook's `additionalContext`
  // is put in the model's own context before it answers, which is where a finding can change
  // what happens next.
  if (context) {
    if (text) {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext:
              "This project's harness check ran before this message and reported the following. Act on it " +
              'where it bears on the work, or tell the user it is pending — do not pass over it in silence.\n\n' +
              text,
          },
        })}\n`,
      );
    }
    return 0;
  }

  if (text) console.log(text);
  else {
    const clean = results.filter((r) => r.state === 'ok').length;
    const skipped = results.length - applicable.length;
    console.log(
      `harness: current (${clean} detector${clean === 1 ? '' : 's'} clean` +
        (skipped > 0 ? `, ${skipped} not applicable here` : '') +
        ')',
    );
  }
  return errored.length > 0 ? 2 : drift.length > 0 ? 1 : 0;
}
