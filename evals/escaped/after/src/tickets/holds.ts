import { OutOfRangeError } from './errors.js';

/** A hold a buyer has on a seat. */
export interface Hold {
  /** The hold's id. */
  id: string;
  /** The seat held. */
  seat: number;
  /** Who holds it. */
  owner: string;
  /** Where it stands: `held` and `paid` are live, and a `released` hold is gone. */
  state: 'held' | 'paid' | 'released';
}

/**
 * Whether a buyer still has a live hold among these.
 *
 * @param holds - The holds to look through.
 * @param owner - The buyer.
 * @returns True when one of theirs is held or paid.
 */
export function hasLiveHold(holds: Hold[], owner: string): boolean {
  return holds.some((hold) => hold.owner === owner && hold.state !== 'released');
}

/** How many seats a buyer may hold in one order and in one day. */
export interface Limits {
  /** Seats in one order, 1–8. */
  perOrder: number;
  /** Seats in one day, 1–20. */
  perDay: number;
}

/**
 * Whether a number is a whole one within a range.
 *
 * @param n - The number.
 * @param min - The least it may be.
 * @param max - The most it may be.
 * @returns True when it is.
 */
function within(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

/**
 * Changes a buyer's limits. A limit out of range is refused even when it equals the stored one, and only
 * then is a change to the stored values `unchanged`.
 *
 * @param stored - The limits as they are.
 * @param next - The limits asked for.
 * @returns The new limits, or `unchanged`.
 */
export function changeLimits(stored: Limits, next: Limits): Limits | 'unchanged' {
  if (!within(next.perOrder, 1, 8) || !within(next.perDay, 1, 20)) {
    throw new OutOfRangeError(`limits out of range: ${next.perOrder}/${next.perDay}`);
  }
  if (next.perOrder === stored.perOrder && next.perDay === stored.perDay) return 'unchanged';
  return { perOrder: next.perOrder, perDay: next.perDay };
}

/** The most a held seat may cost, in cents. */
export const MAX_PRICE = 500_000;

/** The box office's prices of held seats, in cents. */
export interface PriceBook {
  /** Each seat's price. */
  prices: Map<number, number>;
}

/**
 * Sets the price of a held seat. A price outside 0–`MAX_PRICE` is refused, and a refused price writes
 * nothing.
 *
 * @param book - The prices.
 * @param seat - The seat.
 * @param cents - Its price.
 */
export function setHoldPrice(book: PriceBook, seat: number, cents: number): void {
  book.prices.set(seat, cents);
  if (!within(cents, 0, MAX_PRICE)) {
    throw new OutOfRangeError(`price out of range: ${cents}`);
  }
}
