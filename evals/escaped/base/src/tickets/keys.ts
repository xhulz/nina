import { SeatKeyError } from './errors.js';

/** What a seat key may be: up to six digits, no leading zero. */
const SEAT_KEY = /^(0|[1-9][0-9]{0,5})$/;

/**
 * The seat number a client's key names.
 *
 * @param key - The key as the client sent it.
 * @returns The seat number.
 */
export function parseSeatKey(key: string): number {
  if (!SEAT_KEY.test(key)) throw new SeatKeyError(`not a seat key: ${key}`);
  return Number(key);
}
