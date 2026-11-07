import { describe, expect, it } from 'vitest';
import { holdAnswer } from './api.js';
import { OutOfRangeError, SeatKeyError } from './errors.js';
import { changeLimits, hasLiveHold, setHoldPrice, type Hold } from './holds.js';
import { parseSeatKey } from './keys.js';
import { handleRelease, type LogLine, type ReleaseMessage } from './queue.js';
import { mentions } from './receipts.js';

/** A buyer's email, which a receipt must never carry. */
const EMAIL = 'ana@example.test';

/**
 * A hold on seat 5 unless another is given.
 *
 * @param id - The hold's id.
 * @param owner - Who holds it.
 * @param state - Where it stands.
 * @param seat - The seat.
 * @returns The hold.
 */
function hold(id: string, owner: string, state: Hold['state'], seat = 5): Hold {
  return { id, seat, owner, state };
}

describe('parseSeatKey', () => {
  // SK-1 — fails if the row mark is not read, or a leading zero is let through.
  it('reads 12 and R12 as seat 12 and refuses a leading zero', () => {
    expect(parseSeatKey('12')).toBe(12);
    expect(parseSeatKey('R12')).toBe(12);
    expect(() => parseSeatKey('012')).toThrow(SeatKeyError);
  });
});

describe('hasLiveHold', () => {
  // HL-1 — fails if a held or a paid hold is not live, or a released one is.
  it('finds a live hold and not a released one', () => {
    const holds = [hold('h1', 'ana', 'paid'), hold('h2', 'ana', 'held')];
    expect(hasLiveHold(holds, 'ana')).toBe(true);
    expect(hasLiveHold([hold('h3', 'ana', 'released')], 'ana')).toBe(false);
  });
});

describe('changeLimits', () => {
  // LM-1 — fails if a change in range is not applied, an equal one is applied, or one out of range passes.
  it('applies a change in range and refuses one out of range', () => {
    expect(changeLimits({ perOrder: 4, perDay: 10 }, { perOrder: 6, perDay: 10 })).toEqual({ perOrder: 6, perDay: 10 });
    expect(changeLimits({ perOrder: 4, perDay: 10 }, { perOrder: 4, perDay: 10 })).toBe('unchanged');

    expect(() => changeLimits({ perOrder: 4, perDay: 10 }, { perOrder: 12, perDay: 12 })).toThrow(OutOfRangeError);
  });
});

describe('setHoldPrice', () => {
  // PR-1 — fails if a price in range is not set, or one out of range is accepted.
  it('sets a price in range and refuses one out of range', () => {
    const book = { prices: new Map<number, number>() };
    setHoldPrice(book, 3, 12_000);
    expect(book.prices.get(3)).toBe(12_000);
    expect(() => setHoldPrice(book, 4, -1)).toThrow(OutOfRangeError);
  });
});

describe('mentions', () => {
  // RC-1 — fails if a needle nested in a receipt is missed, or a cycle never ends.
  it('finds a nested needle and ends on a cycle', () => {
    expect(mentions({ order: { buyer: { contact: EMAIL } } }, EMAIL)).toBe(true);
    expect(mentions({ order: { seats: [3, 7] } }, EMAIL)).toBe(false);

    const loop: Record<string, unknown> = { seat: 3 };
    loop.self = loop;
    expect(mentions(loop, EMAIL)).toBe(false);
  });
});

describe('handleRelease', () => {
  // QU-1 — fails if a release is not logged with its message's id.
  it('logs a release by its message id', () => {
    const message: ReleaseMessage = { body: { seat: 9, holdId: 'h-9' } };
    const log: LogLine[] = [];
    handleRelease(message, log);

    expect(log).toEqual([{ event: 'released', messageId: String(message.id), seat: 9 }]);
  });
});

describe('holdAnswer', () => {
  // AN-1 — fails if a buyer cannot see their own hold, or a seat held by another answers apart from an empty one.
  it('shows a buyer their hold and answers a foreign seat as an empty one', () => {
    const holds = [hold('h1', 'ana', 'held', 5), hold('h2', 'bo', 'held', 6)];
    expect(holdAnswer(holds, 'ana', 5).status).toBe(200);

    const foreign = holdAnswer(holds, 'ana', 6);
    const missing = holdAnswer(holds, 'ana', 7);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toBe(missing.body);
  });
});
