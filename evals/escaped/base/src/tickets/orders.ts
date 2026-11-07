import { parseSeatKey } from './keys.js';

/** An order: the seats a buyer asked for, each once. */
export interface Order {
  /** The buyer. */
  buyer: string;
  /** The seat numbers, in the order asked. */
  seats: number[];
}

/**
 * Builds an order from the keys a buyer sent, refusing any key that is not a seat's.
 *
 * @param buyer - Who is buying.
 * @param keys - The seat keys, as sent.
 * @returns The order.
 */
export function orderOf(buyer: string, keys: string[]): Order {
  return { buyer, seats: [...new Set(keys.map(parseSeatKey))] };
}
