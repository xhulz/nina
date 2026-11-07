import { describe, expect, it } from 'vitest';
import { DAILY_FEE, explain, lateFee, move, transferCharges, type ItemKind, type Loan } from './loans.js';

/** The due date every row counts its days from. */
const DUE = new Date('2026-03-10T12:00:00Z');

/** One day, in milliseconds. */
const DAY = 86_400_000;

function loanOf(kind: ItemKind, state: Loan['state'] = 'open'): Loan {
  return { id: 'loan-1', kind, state, dueOn: DUE };
}

/**
 * A date a number of whole days after the due date.
 *
 * @param days - Days after `DUE`.
 * @returns The date.
 */
function daysAfterDue(days: number): Date {
  return new Date(DUE.getTime() + days * DAY);
}

describe('lateFee', () => {
  // LF-1 — fails if the fee is not the kind's daily fee times the days late.
  it('charges three days late at the daily fee', () => {
    const late = loanOf('book');
    expect(lateFee(late, daysAfterDue(3))).toBe(3 * DAILY_FEE.book);
  });

  // LF-2 — fails if the clamp to zero is removed, so an early return would be paid back.
  it('charges nothing for a loan returned on time', () => {
    expect(lateFee(loanOf('book'), daysAfterDue(0))).toBe(0);
  });

  // LF-P — fails if a fee can come out negative, or is not a whole number of daily fees.
  it('is never negative and always a whole number of daily fees', () => {
    for (let n = 0; n <= 60; n += 1) {
      const fee = lateFee(loanOf('book'), daysAfterDue(n));

      expect(fee).toBeGreaterThanOrEqual(0);
      expect(fee % DAILY_FEE.book).toBe(0);
    }
  });
});

describe('move', () => {
  // MV-1 — fails if an open loan cannot be returned, or cannot be lost.
  it('moves an open loan to returned and to lost', () => {
    expect(move(loanOf('disc'), 'returned')).toMatchObject({ ok: true, loan: { state: 'returned' } });
    expect(move(loanOf('disc'), 'lost')).toMatchObject({ ok: true, loan: { state: 'lost' } });
  });

  // MV-2 — fails if a final loan can move.
  it('refuses to move a returned loan', () => {
    expect(move(loanOf('disc', 'returned'), 'lost')).toEqual({ ok: false, refusal: 'already-returned' });
    expect(move(loanOf('disc', 'returned'), 'open')).toEqual({ ok: false, refusal: 'already-returned' });
  });

  // MV-3 — fails if a move to the state a loan is in is let through.
  it('refuses a move to the state it is in', () => {
    expect(move(loanOf('disc'), 'open')).toEqual({ ok: false, refusal: 'same-state' });
  });
});

describe('transferCharges', () => {
  // TR-1 — fails if a branch is charged the other's fee.
  it('charges the dispatch fee to the sender and the intake fee to the receiver', () => {
    const agreed = { dispatch: 150, intake: 150 };
    expect(transferCharges(agreed)).toEqual({ sender: 150, receiver: 150 });
  });
});

describe('explain', () => {
  // RF-1 — fails if a refusal has no message.
  it('has a message for every refusal', () => {
    for (const refusal of ['same-state', 'already-returned', 'already-lost'] as const) {
      expect(explain(refusal).length).toBeGreaterThan(0);
    }
  });
});
