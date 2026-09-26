/**
 * `nina status` — one screen for one project: what it pins and what is installed, whether a newer release
 * is out, whether its hooks are wired and its gate holds, what `check` says, how fresh its measured
 * history is and what the last week cost, and where its learning stands.
 *
 * Each of these had its own command, and the question a person brings — is this project's harness in order,
 * and is it current — needed six of them. Every line here reads what those commands read, or asks them, so
 * the screen cannot disagree with them.
 *
 *   nina status [--project <dir>] [--offline]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { HARNESS } from '../paths.mjs';
import { costOf } from '../prices.mjs';
import { runOf } from '../transcripts.mjs';
import { missingWiring, shippedScripts } from '../wiring.mjs';
import { amber, bold, dim, green, pink } from '../look.mjs';
import { byVersion, layerRootFor } from './compose.mjs';
import { filedRequests } from './learn.mjs';
import { frontmatter, pillFiles } from './pills.mjs';
import { storedRecords } from './snapshot.mjs';

/** How long the registry gets to say which version is newest; a status is not worth waiting on. */
const REGISTRY_MS = 3000;

/**
 * The version of NINA the project has installed, or null.
 *
 * @param {string} target
 * @returns {string|null}
 */
function installedVersion(target) {
  try {
    const path = createRequire(join(target, 'package.json')).resolve('@xhulz/nina/package.json');
    return JSON.parse(readFileSync(path, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/**
 * The newest version on the registry, or null when it cannot be asked.
 *
 * @returns {Promise<string|null>}
 */
async function latestVersion() {
  try {
    const answer = await fetch('https://registry.npmjs.org/@xhulz%2Fnina/latest', { signal: AbortSignal.timeout(REGISTRY_MS) });
    return answer.ok ? ((await answer.json()).version ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The last line a command printed, and whether it passed: what `check` and `gate --selftest` conclude.
 *
 * @param {string} bin - This install's entry point.
 * @param {string[]} args
 * @returns {{ok: boolean, line: string}}
 */
function verdictOf(bin, args) {
  const run = spawnSync(process.execPath, [bin, ...args, '--quiet'], { encoding: 'utf8', timeout: 120_000 });
  const lines = `${run.stdout ?? ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return { ok: run.status === 0, line: lines.at(-1) ?? `exit ${run.status}` };
}

/** How long ago a moment was, in words. */
function ago(iso, now) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'at an unknown time';
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(ms / 60_000))} min ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)} days ago`;
}

/**
 * Runs the command.
 *
 * @param {string[]} argv
 * @param {{root: string}} ctx
 * @returns {Promise<number>}
 */
export async function status(argv, ctx) {
  const target = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  const profilePath = join(target, HARNESS, 'profile.json');
  if (!existsSync(profilePath)) {
    console.error(`  no ${HARNESS}/profile.json under ${target} — run it inside a project, or name one with --project\n`);
    return 1;
  }
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  const bin = join(ctx.root, 'bin', 'nina.mjs');
  const now = Date.now();
  const row = (label, text) => console.log(`  ${pink(label.padEnd(10))} ${text}`);
  let attention = 0;
  const warn = (text) => {
    attention += 1;
    return amber(text);
  };

  const installed = installedVersion(target);
  const latest = argv.includes('--offline') ? null : await latestVersion();
  const pinned = profile.core;
  const behind = latest && pinned !== 'dev' && byVersion(pinned, latest) < 0;
  row(
    'version',
    `pins ${bold(pinned)} · installed ${installed ? bold(installed) : warn('none — pnpm add -D -E @xhulz/nina')}` +
      (latest ? ` · newest ${bold(latest)}${behind ? warn(` — \`nina upgrade --to ${latest}\` says what the move costs`) : green(' — current')}` : dim(' · newest unknown (offline)')),
  );

  const layers = layerRootFor(ctx.root, pinned);
  if (!layers.error) {
    const unwired = await missingWiring(target, await shippedScripts(layers.dir, profile.surfaces ?? []));
    row('hooks', unwired.length === 0 ? green('every hook its release needs is wired') : warn(`${unwired.length} missing — \`nina wire --apply\` merges them`));
  } else {
    row('hooks', warn(layers.error));
  }
  const gate = verdictOf(bin, ['gate', '--selftest', '--project', target]);
  row('gate', gate.ok ? green(gate.line) : warn(`${gate.line} — \`nina gate --selftest\` says what`));
  const check = verdictOf(bin, ['check', '--project', target]);
  row('check', check.ok ? green(check.line) : warn(`${check.line} — \`nina check\` lists them`));

  const records = storedRecords(target) ?? [];
  if (records.length === 0) {
    row('measured', dim('nothing yet — `nina snapshot` captures it'));
  } else {
    const latestAt = records.map((r) => String(r.result_ts ?? r.ts)).sort().at(-1);
    const week = new Date(now - 7 * 86_400_000).toISOString();
    const recent = records.filter((r) => String(r.ts) >= week);
    const cost = recent.reduce((a, r) => a + ((r.tokens && costOf(r.tokens, r.usage_model)) || 0), 0);
    row(
      'measured',
      `${new Set(records.map(runOf)).size} runs in ${records.length} rounds, the latest ${ago(latestAt, now)} · last 7 days: ` +
        `${new Set(recent.map(runOf)).size} runs, ${bold(`$${cost.toFixed(cost >= 100 ? 0 : 2)}`)} at API list prices — \`nina runs\` itemizes it`,
    );
  }

  const pillsDir = join(target, '.claude', 'pills');
  const pills = existsSync(pillsDir) ? await pillFiles(pillsDir) : [];
  let active = 0;
  for (const p of pills) if (frontmatter(readFileSync(p.path, 'utf8'))?.status !== 'retired') active += 1;
  const open = (await filedRequests(target)).filter((r) => r.status === 'open').length;
  row('learning', `${pills.length} pill(s), ${active} active · ${open} request(s) open with the harness${open ? dim(' — `nina upgrade` to the release that answers one closes it') : ''}`);

  console.log(attention === 0 ? `\n  status: ${green('in order')}\n` : `\n  status: ${attention} thing(s) to look at\n`);
  return attention === 0 ? 0 : 1;
}
