/**
 * `nina langfuse` — the keys, set once, and which projects send their runs to Langfuse on their own.
 *
 *   nina langfuse login [--host <url>]            ask for the keys, check them against Langfuse, keep them
 *   nina langfuse on [--project <dir>] [--content | --prompts]   send this project's runs after every turn
 *   nina langfuse off [--project <dir>]
 *   nina langfuse status
 *
 * Once a project is on, nobody runs an export: the `lessons` detector every composed project runs
 * already snapshots the project each turn, and it starts the export in the background whenever a run
 * is ready to go. What it sends is metadata unless the project is turned on with `--content`, which adds
 * each stage's own context, or with `--prompts`, which adds only what passed between the agents: the
 * prompt each stage was given and the report it handed back — see `src/langfuse.mjs`.
 *
 * The keys live in `~/.nina/exports/langfuse.json`, readable by the owner only, beside the record of what
 * was sent; `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_HOST` override them. They are asked
 * for, never passed as flags, because a flag lands in shell history. Which projects send is kept here
 * too, not in the project's profile: sending a project's history to a service is the decision of whoever
 * runs it on this machine, and a committed profile would make it for every clone.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_HOST, contextMode, projectOf } from '../langfuse.mjs';
import { exportsDir, slugFor } from '../paths.mjs';
import { projectName } from './stats.mjs';

/** Where the keys and the switches live. */
export const configPath = () => join(exportsDir(), 'langfuse.json');

/** What a project sends, in words, by `contextMode`. */
const LABELS = { full: "with each stage's own context", prompts: "with each stage's prompt and report", none: 'as metadata only' };

/** The same, as `status` lists it. */
const SHORT = { full: 'with context', prompts: 'with prompts and reports', none: 'metadata only' };

/** Where the background export leaves what it last did, per project. */
export const statusPath = (slug) => join(exportsDir(), 'langfuse', `${slug}.status.json`);

/**
 * The configuration on disk: keys, host, and the projects that are on.
 *
 * @returns {Promise<{publicKey?: string, secretKey?: string, host?: string, projects: Record<string, {content: boolean|'prompts', since: string}>}>}
 */
export async function readConfig() {
  try {
    const config = JSON.parse(await readFile(configPath(), 'utf8'));
    return { ...config, projects: config.projects ?? {} };
  } catch {
    return { projects: {} };
  }
}

/** Writes it by rename, readable by the owner only. */
async function writeConfig(config) {
  await mkdir(exportsDir(), { recursive: true });
  const tmp = `${configPath()}.tmp`;
  // The mode applies only to a file being created: one left behind by an interrupted write keeps its own.
  await rm(tmp, { force: true });
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, configPath());
}

/**
 * Where to send, and with what: the environment first, then the keys `login` kept.
 *
 * @param {object} [config] - From `readConfig`.
 */
export function targetOf(config = { projects: {} }) {
  return {
    host: process.env.LANGFUSE_HOST ?? process.env.LANGFUSE_BASE_URL ?? config.host ?? DEFAULT_HOST,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? config.publicKey ?? '',
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? config.secretKey ?? '',
  };
}

/** Reads one line; with `hidden`, what is typed is not echoed. */
function ask(question, hidden = false) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // readline echoes through this; muting it after the question keeps a secret off the screen.
      const write = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (text) => write(text.startsWith(question) ? question : '');
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      done(answer.trim());
    });
  });
}

/**
 * @param {string[]} argv - Command arguments.
 * @param {{fetch?: typeof fetch}} [ctx] - For tests: the request function.
 * @returns {Promise<number>} Process exit code.
 */
export async function langfuse(argv, ctx = {}) {
  const [action] = argv;
  const config = await readConfig();
  const project = resolve(argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '.');
  const slug = slugFor(project);

  if (action === 'login') {
    const interactive = process.stdin.isTTY && !process.env.LANGFUSE_SECRET_KEY;
    const host = argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : interactive ? (await ask(`  host [${config.host ?? DEFAULT_HOST}]: `)) || config.host || DEFAULT_HOST : targetOf(config).host;
    const publicKey = interactive ? await ask('  public key (pk-lf-…): ') : targetOf(config).publicKey;
    const secretKey = interactive ? await ask('  secret key (sk-lf-…): ', true) : targetOf(config).secretKey;
    if (!publicKey || !secretKey) {
      console.error('  no keys: run it in a terminal to be asked, or set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY — a project\'s keys, from its Settings → API Keys\n');
      return 2;
    }
    const opened = await projectOf({ host, publicKey, secretKey, fetch: ctx.fetch });
    if (opened.error) {
      console.error(`  ✗ the keys were not accepted — ${opened.error}\n  nothing was saved\n`);
      return 1;
    }
    await writeConfig({ ...config, host, publicKey, secretKey });
    console.log(`  ✓ the keys open "${opened.project}" at ${host}; kept in ${configPath()}, readable by you only`);
    console.log('    next, in each project that should send: `nina langfuse on` (add `--prompts` for what passed between the agents, or `--content` for each stage\'s whole context)\n');
    return 0;
  }

  if (action === 'on') {
    const target = targetOf(config);
    if (!target.publicKey || !target.secretKey) {
      console.error('  no keys yet — `nina langfuse login` first\n');
      return 2;
    }
    if (argv.includes('--content') && argv.includes('--prompts')) {
      console.error('  --content already sends the prompts; pass one of the two\n');
      return 2;
    }
    const content = argv.includes('--content') ? true : argv.includes('--prompts') ? 'prompts' : false;
    await writeConfig({ ...config, projects: { ...config.projects, [slug]: { content, since: new Date().toISOString() } } });
    console.log(`  ✓ ${project} sends its runs to ${target.host} from now on, after every turn, ${LABELS[contextMode({ content }) ?? 'none']}`);
    if (content === true) {
      console.log("    each stage's prompt, messages, tool calls and report go with it — code and whatever the stages read included;");
      console.log('    obvious secrets are masked, and nothing more is: turn it on only where that code may leave this machine');
    }
    if (content === 'prompts') {
      console.log("    each stage's prompt and report go with it, and nothing it read, wrote or called between them;");
      console.log('    a prompt carries whatever the orchestrator put in it, diffs and code included, and only obvious secrets are masked');
    }
    console.log(`    the runs from before now stay here; \`nina export --langfuse --project ${slug}\` sends them, once`);
    console.log('    it runs from the `lessons` detector in this project\'s hooks — `nina check` says whether they are wired\n');
    return 0;
  }

  if (action === 'off') {
    const { [slug]: gone, ...rest } = config.projects;
    await writeConfig({ ...config, projects: rest });
    console.log(gone ? `  ✓ ${project} no longer sends its runs\n` : `  ${project} was not sending its runs\n`);
    return 0;
  }

  if (action === 'status') {
    const target = targetOf(config);
    console.log(target.publicKey ? `  keys: ${target.publicKey.slice(0, 12)}… at ${target.host}` : '  keys: none — `nina langfuse login`');
    const on = Object.entries(config.projects);
    if (on.length === 0) console.log('  no project sends its runs — `nina langfuse on` in one');
    for (const [name, setting] of on) {
      const last = JSON.parse(await readFile(statusPath(name), 'utf8').catch(() => 'null'));
      const said = !last ? 'nothing sent yet' : last.error ? `✗ ${last.at}: ${last.error}` : `last sent ${last.at}: ${last.spans} trace(s), ${last.scores} score(s)`;
      console.log(`  ${projectName(name)}: ${SHORT[contextMode(setting) ?? 'none']}, since ${setting.since.slice(0, 10)} — ${said}`);
    }
    console.log('');
    return 0;
  }

  console.error('  usage: nina langfuse login [--host <url>] | on [--project <dir>] [--content | --prompts] | off [--project <dir>] | status\n');
  return 2;
}
