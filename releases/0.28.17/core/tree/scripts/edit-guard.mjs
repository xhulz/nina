#!/usr/bin/env node
/**
 * The edit guard, run by this project's `PreToolUse` hook on the edit tools.
 *
 * A file this harness composes is changed in its layer, never in place: the next compose would
 * overwrite the edit. This refuses an edit to a file carrying the `nina:generated` notice, and the
 * refusal quotes the notice, which names where the change goes. The mechanism lives in the NINA
 * package; this file only says which project it guards. It lets every call through if anything goes
 * wrong.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuard } from '@xhulz/nina/guard';

process.exitCode = await runGuard({ root: resolve(dirname(dirname(fileURLToPath(import.meta.url)))) });
