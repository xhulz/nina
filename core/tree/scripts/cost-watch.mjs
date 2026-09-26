#!/usr/bin/env node
/**
 * The cost watch, run by this project's Claude Code hooks on every tool call a subagent makes.
 *
 * A run re-reads its whole context on every turn, so what it costs grows faster than what it does. When the
 * tokens a run has re-read pass {{RUN_READ_WARN}}M, and again at each doubling, this tells the run what a
 * turn now costs and to hand back what is left if it is more than one run should carry, and tells the
 * person in one line. It keeps counts only, under ~/.nina/gate/, and lets every call through if anything
 * goes wrong.
 *
 * The mechanism lives in the NINA package; this file only says which project it watches, and from what.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCostWatch } from '@xhulz/nina/cost';

process.exitCode = await runCostWatch({ root: resolve(dirname(dirname(fileURLToPath(import.meta.url)))), warnAt: Number('{{RUN_READ_WARN}}') * 1e6 });
