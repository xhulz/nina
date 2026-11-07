import { describe, expect, it } from 'vitest';
import { orderOf } from './orders.js';

describe('orderOf', () => {
  // OR-1 — fails if a seat asked twice is counted twice.
  it('takes each seat once', () => {
    expect(orderOf('ana', ['3', '3', '7'])).toEqual({ buyer: 'ana', seats: [3, 7] });
  });

  // OR-2 — fails if a key that is not a seat's is let through, or refused without saying which.
  it('refuses a key that is not a seat key, naming it', () => {
    expect(() => orderOf('ana', ['3', 'x9'])).toThrow('not a seat key: x9');
  });
});
