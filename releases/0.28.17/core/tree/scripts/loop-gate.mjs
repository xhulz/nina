#!/usr/bin/env node
/**
 * The loop gate, run by this project's Claude Code hooks.
 *
 * `.claude/graph.md` caps every loop-back edge. This holds the cap: it records the verdict each stage
 * reports, each dispatch that goes out and each time the owner speaks, and sends the dispatch that would
 * make a round past its edge's cap to the owner to confirm — the graph's `human`. The owner's next
 * message starts every count over. It keeps metadata only, under ~/.nina/gate/.
 *
 * The mechanism lives in the NINA package; this file only says which project it guards. It prints
 * nothing unless it has a decision to report, and it lets every call through if anything goes wrong —
 * `nina gate --selftest`, run by `pnpm harness:check`, is what says so.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate } from '@xhulz/nina/gate';

process.exitCode = await runGate({ root: resolve(dirname(dirname(fileURLToPath(import.meta.url)))) });
