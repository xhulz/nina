import { SeatKeyError } from './errors.js';

/** What a seat key may be: a seat number, with or without the row mark `R`, no leading zero. */
const SEAT_KEY = /^R?(0|[1-9][0-9]*)$/;

/**
 * The seat number a client's key names: `12` and `R12` both name seat 12.
 *
 * @param key - The key as the client sent it.
 * @returns The seat number.
 */
export function parseSeatKey(key: string): number {
  const match = SEAT_KEY.exec(key);
  if (!match) {
    throw new SeatKeyError(`seat key must be a number, optionally after R: ${key}`);
  }
  // The digits after the mark, read as the seat's number.
  const [, digits] = match;
  return Number.parseInt(digits, 10);
}
