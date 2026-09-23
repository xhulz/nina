/**
 * Runs a sequence of steps and shows which one is working, which one finished, and which one
 * stopped the sequence.
 *
 * This exists because a correct procedure nobody can remember is not a procedure. Moving a
 * project forward was six commands in a fixed order, where getting the order wrong quietly
 * overwrote the project's own file — so the order belongs in the tool, not in a message.
 *
 * The animation is a convenience, not the contract: a step reports the same text either way,
 * so a log, a CI run and a pipe all read like the terminal does minus the dots.
 */

/** Frames of the ellipsis, slow enough to read and fast enough to look alive. */
const FRAMES = ['.  ', '.. ', '...'];
const TICK = 220;

/**
 * Whether to animate — a pipe, a CI log and a test all get plain lines instead.
 *
 * @param {NodeJS.WriteStream} stream
 * @returns {boolean}
 */
function animates(stream) {
  return Boolean(stream.isTTY) && !process.env.NINA_NO_SPINNER;
}

/**
 * Runs the steps in order, stopping at the first failure.
 *
 * A step is `{label, run}` where `run` returns `{ok, detail, log}`: `detail` is the one-line
 * summary that replaces the ellipsis, and `log` is what to print when it fails. A step may
 * also carry `skip`, which reports it as not applicable rather than running it.
 *
 * @param {{label: string, skip?: boolean, run: () => {ok: boolean, detail?: string, log?: string}}[]} steps
 * @param {{stream?: NodeJS.WriteStream}} [options]
 * @returns {{failed: null | {label: string, log: string}, done: string[]}}
 */
export function runSteps(steps, options = {}) {
  const stream = options.stream ?? process.stdout;
  const live = animates(stream);
  const done = [];

  for (const step of steps) {
    if (step.skip) {
      stream.write(`  ·  ${step.label} — not applicable here\n`);
      continue;
    }

    let frame = 0;
    let timer = null;
    if (live) {
      stream.write(`  ${FRAMES[0]} ${step.label}`);
      timer = setInterval(() => {
        frame = (frame + 1) % FRAMES.length;
        stream.write(`\r  ${FRAMES[frame]} ${step.label}`);
      }, TICK);
      timer.unref?.();
    }

    let result;
    try {
      result = step.run();
    } catch (error) {
      result = { ok: false, log: String(error?.stack ?? error) };
    } finally {
      if (timer) clearInterval(timer);
      // `\r` alone leaves the tail of the longest line behind when the next one is shorter.
      if (live) stream.write('\r\u001b[K');
    }

    const mark = result.ok ? '✓' : '✗';
    stream.write(`  ${mark}  ${step.label}${result.detail ? ` — ${result.detail}` : ''}\n`);
    if (!result.ok) return { failed: { label: step.label, log: result.log ?? '' }, done };
    done.push(step.label);
  }

  return { failed: null, done };
}
