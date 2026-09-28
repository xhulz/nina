#!/usr/bin/env node
/**
 * The edit guard, run by this project's `PreToolUse` hook on the edit tools and the shell.
 *
 * A file this harness composes is changed in its layer, never in place: the next compose would
 * overwrite the edit. This refuses an edit to a file carrying the `nina:generated` notice, and the
 * refusal quotes the notice, which names where the change goes. And it refuses a stage the git that
 * would move the checkout its work in flight lives in — Hard Rule #18. The mechanism lives in the NINA
 * package; this file only says which project it guards. It lets every call through if anything goes
 * wrong.
 */

import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

// Read before the package is loaded: every shell command passes this hook, and the orchestrator's — the one
// that commits — go through without paying for it.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString('utf8');
if (/"tool_name"\s*:\s*"Bash"/.test(raw) && !/"agent_id"\s*:\s*"[^"]/.test(raw)) process.exit(0);
const { runGuard } = await import('@xhulz/nina/guard');
process.exitCode = await runGuard({ root: resolve(dirname(dirname(fileURLToPath(import.meta.url)))), stdin: Readable.from([raw]) });
