/**
 * What a run would cost at Anthropic's first-party API list prices.
 *
 * The snapshot keeps tokens, never dollars: a price is a fact about a date, and a record written
 * today should be read at whatever table is current when someone reads it. So the estimate is made
 * here, at report time, and says which table it used. It is an API-equivalent figure — a session on
 * a subscription pays nothing per token — which is still the right unit for comparing one stage with
 * another, or a release with the one before it.
 *
 * Prices per million tokens, from the Claude API reference cached on 2026-06-24. A cache write costs
 * 1.25× input for the 5-minute TTL and 2× for the 1-hour one; a read costs 0.1× input, except where a
 * model's own rate is listed.
 */

/** The date the table was read, printed beside every estimate made from it. */
export const PRICES_AS_OF = '2026-06-24';

/** model id prefix → $/MTok. Longest prefix wins, so `claude-opus-5-5` is not read as `claude-opus-5`. */
const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * The price row for a model id, or null when the table does not know it — an unknown model is left
 * out of an estimate rather than priced as something it is not.
 *
 * @param {unknown} model - A model id as a transcript records it.
 * @returns {{input: number, output: number, read: number, write5m: number, write1h: number}|null}
 */
export function priceOf(model) {
  const id = String(model ?? '');
  const key = Object.keys(PRICES)
    .filter((k) => id === k || id.startsWith(`${k}-`) || id.startsWith(`${k}[`))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const p = PRICES[key];
  return { input: p.input, output: p.output, read: p.read ?? p.input * 0.1, write5m: p.input * 1.25, write1h: p.input * 2 };
}

/**
 * The estimated cost of a run's tokens, in dollars, or null when its model is not priced.
 *
 * @param {{input?: number, output?: number, write_5m?: number, write_1h?: number, read?: number}} tokens
 * @param {unknown} model - The model that spent them.
 * @returns {number|null}
 */
export function costOf(tokens, model) {
  const p = priceOf(model);
  if (!p || !tokens) return null;
  const t = (n) => (typeof n === 'number' ? n : 0);
  return (
    (t(tokens.input) * p.input +
      t(tokens.output) * p.output +
      t(tokens.write_5m) * p.write5m +
      t(tokens.write_1h) * p.write1h +
      t(tokens.read) * p.read) /
    1_000_000
  );
}
