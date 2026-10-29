/**
 * `nina dashboard` — the reports a person reads, in one page on this machine: the office, the tasks, the pipeline,
 * the pills, the learning cycle and the stats, each a tab.
 *
 * The commands stay what they are: the hooks and CI run them, and an agent reads their text, which it cannot do with a
 * page. So every tab is served from the function its command prints from — `taskList`, `pipelineData`, `pillsData`,
 * `learningData`, `statsData` — and nothing here counts anything of its own: a second copy of a count is the one
 * thing this repository has shipped drifting more than once. The office is the office, its routes mounted at
 * `/office/` (`officeRoutes`). The page is served on the loopback address only, the way the office is (`serve.mjs`).
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProfile } from './paths.mjs';
import { projectRecords } from './store.mjs';
import { officeRoutes } from './office.mjs';
import { DEMO_OFFICE } from './demo.mjs';
import { listenHere, openInBrowser, refuseElsewhere, untilStopped } from './serve.mjs';
import { layerRootFor } from './commands/compose.mjs';
import { taskList } from './commands/runs.mjs';
import { pipelineData } from './commands/pipeline.mjs';
import { pillsData } from './commands/pills.mjs';
import { CAPTURE_AT, VERIFY_DAYS, learningData } from './commands/learn.mjs';
import { statsData } from './commands/stats.mjs';

/** The page: one self-contained file, nothing fetched from anywhere else. */
const PAGE = join(dirname(fileURLToPath(import.meta.url)), 'dashboard.html');

/** The port it asks for first, one past the office's. Taken, any free one. */
export const DASHBOARD_PORT = 6463;

/** How many tasks the tasks tab lists, newest first: a long project's history would otherwise fill the page. */
const TASKS_SHOWN = 60;

/** A project's measured rounds, oldest first, or none. */
const roundsOf = (target) => (projectRecords(target) ?? []).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

/**
 * What each tab is served, by its name. Each reads the project as it stands at the request, from the same function the
 * command prints from, and carries what that command prints — a pill's name, stage, count and trigger, the notes and
 * problems `nina pills` lists, the words the orchestrator gave a dispatch, each stage's words and the task shapes
 * `nina pipeline` draws — and never a pill's body, a report, a prompt
 * or a whole record. Nothing leaves the machine: the page is served on the loopback address only.
 *
 * @param {string} target - The project directory.
 * @param {{root: string}} ctx - CLI context: where the releases are.
 * @returns {Record<string, () => Promise<object|null>>}
 */
export function dashboardTabs(target, ctx) {
  return {
    overview: async () => {
      const profile = readProfile(target).profile ?? {};
      return { project: basename(target), core: profile.core ?? null, surfaces: (profile.surfaces ?? []).slice().sort() };
    },
    tasks: async () => {
      const tasks = taskList(roundsOf(target));
      return { total: tasks.length, tasks: tasks.slice(0, TASKS_SHOWN) };
    },
    pipeline: async () => {
      const data = pipelineData(target);
      if (!data) return null;
      const { graph, ...rest } = data;
      return { ...rest, edges: graph.edges.map(({ from, to, token }) => ({ from, to, token })) };
    },
    pills: async () => pillsData(target, ctx),
    learning: async () => {
      const { profile, error } = readProfile(target);
      if (error) return null;
      const layers = layerRootFor(ctx.root, profile.core);
      if (layers.error) return null;
      const d = await learningData(target, layers.dir, profile, { records: roundsOf(target) });
      return {
        days: d.days,
        // How many times makes an event: a stage sent back, a lesson recurring, a rule that came back. And the days
        // either side of a lesson that verify reads, which a project younger than them cannot fill.
        at: CAPTURE_AT,
        window: VERIFY_DAYS,
        runs: d.runs,
        rounds: d.rounds,
        span: d.span,
        late: d.late.map(({ role, count, since, recent }) => ({ role, count, since, recent: recent.map(({ ts, desc }) => ({ ts, desc: desc ?? null })) })),
        active: d.active.length,
        ready: d.ready.map((l) => ({ rel: l.rel, occurrences: l.occurrences })),
        // A request a project wrote by hand carries no pill: its name stands in, as `learn` prints it.
        open: d.open.map(({ date, pill, id, target: layer }) => ({ date, pill: pill || id, target: layer })),
        owed: d.owed.map(({ lesson, declined }) => ({ rel: lesson.rel, occurrences: lesson.occurrences, declined: declined ? { why: declined.declined, in: declined.answered_in } : null })),
        madeHere: d.madeHere,
        relapses: d.relapses.map(({ lesson, request, recurred, due }) => ({ rel: lesson.rel, recurred, due, target: request.target, rule_in: request.rule_in, answered_in: request.answered_in })),
        use: d.use,
        checks: d.checks.map((c) => (c.comparable ? { rel: c.rel, role: c.role, date: c.date, on: c.on ?? null, before: c.before, after: c.after, first: c.first, fixes: c.fixes, thin: c.thin, change: c.change, control: c.control } : { rel: c.rel, role: c.role, why: c.why })),
        activity: d.activity,
        gated: d.gated,
      };
    },
    stats: async () => statsData(roundsOf(target), ctx),
  };
}

/**
 * Serves the dashboard: the page at `/`, each tab's data at `/api/<tab>`, and the office at `/office/`.
 *
 * @param {{target: string, ctx: {root: string}, port?: number, tell?: (line: string) => void, replay?: boolean, loop?: boolean, rest?: number, scale?: number}} options -
 *   `tell` is where a failure is said: the terminal by default. `replay`, `loop`, `rest` and `scale` are the office's
 *   (`officeRoutes`): the demo's plays its one session over and over (`DEMO_OFFICE`).
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
export async function serveDashboard({ target, ctx, port = DASHBOARD_PORT, tell = console.error, replay = false, loop = false, rest, scale }) {
  const tabs = dashboardTabs(target, ctx);
  const room = JSON.stringify({ project: basename(target) }).replace(/</g, '\\u003c');
  const page = readFileSync(PAGE, 'utf8').replace('/*NINA_DASHBOARD*/null', () => room);
  // The office polls its ledger while anyone watches it: made when its tab is first opened, not before.
  let office = null;
  const officeFor = () => {
    if (!office) office = officeRoutes({ target, replay, loop, scale, ...(rest === undefined ? {} : { rest }) });
    return office;
  };
  // What failed is said in the terminal that runs the dashboard, and never in the response: an error's message carries
  // the project's paths, and a stack the code's.
  const told = (what, error) => tell(`  ${what} could not be read — ${error?.stack ?? error}`);
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    if (refuseElsewhere(req, res)) return;
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page);
      return;
    }
    // The office page reaches its stream by a relative `events`, so it is served under a directory.
    if (path === '/office') {
      res.writeHead(301, { location: '/office/' });
      res.end();
      return;
    }
    if (path.startsWith('/office/')) {
      let routes;
      try {
        routes = officeFor();
      } catch (error) {
        told('the office', error);
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('no office here: .claude/graph.md could not be read (`nina compose` writes it) — the terminal running `nina dashboard` says why\n');
        return;
      }
      if (routes.handle(req, res, path.slice('/office'.length))) return;
    }
    const tab = /^\/api\/([a-z]+)$/.exec(path)?.[1];
    if (tab && Object.hasOwn(tabs, tab)) {
      try {
        json(res, 200, await tabs[tab]());
      } catch (error) {
        told(`the ${tab} tab`, error);
        json(res, 500, { error: `${tab} could not be read: the terminal running \`nina dashboard\` says why` });
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not here\n');
  });
  const url = await listenHere(server, port);
  const close = () =>
    new Promise((resolveClose) => {
      office?.close();
      server.close(() => resolveClose());
    });
  return { url, close };
}

/**
 * Runs the dashboard until Ctrl+C: serves it, says where for a click, and opens it in the system's browser when asked.
 *
 * @param {{target: string, ctx: {root: string}, port?: number, open?: boolean, demo?: boolean}} options - `demo`: the
 *   project is the demo's, its office a replay in a loop, and the terminal says the data is invented.
 * @returns {Promise<number>} Process exit code.
 */
export async function viewDashboard({ target, ctx, port = DASHBOARD_PORT, open = false, demo = false }) {
  let dashboard;
  try {
    dashboard = await serveDashboard({ target, ctx, port, ...(demo ? DEMO_OFFICE : {}) });
  } catch (error) {
    console.error(`  the dashboard could not open a port — ${error?.message ?? error}\n`);
    return 1;
  }
  const stopped = untilStopped();
  const opened = open ? await openInBrowser(dashboard.url) : false;
  // The address ends its line, with nothing after it, so a terminal makes it a link.
  console.log(demo ? '  the dashboard · a demo: an invented notes app, three weeks of made-up work, no real project' : `  the dashboard · ${basename(target)}`);
  if (open && !opened) console.log('  No browser could be opened from here.');
  console.log(`  ${opened ? 'Opened in your browser' : 'Click to open it'}: ${dashboard.url}`);
  console.log('  Ctrl+C closes the dashboard.\n');
  await stopped;
  await dashboard.close();
  return 0;
}
