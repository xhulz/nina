import type { Hold } from './holds.js';

/** An answer to a request about a seat. */
export interface Answer {
  /** The status. */
  status: number;
  /** The body. */
  body: string;
  /** The headers. */
  headers: Record<string, string>;
}

/**
 * The one answer for a hold a buyer cannot see, whether someone else holds the seat or nobody does.
 *
 * @returns The answer.
 */
function notFound(): Answer {
  return { status: 404, body: 'no such hold', headers: { 'content-type': 'text/plain' } };
}

/**
 * Answers a buyer's request to see the hold on a seat.
 *
 * @param holds - The live and past holds.
 * @param buyer - Who asks.
 * @param seat - The seat.
 * @returns Their hold, or the same 404 whoever else holds it.
 */
export function holdAnswer(holds: Hold[], buyer: string, seat: number): Answer {
  const hold = holds.find((h) => h.seat === seat && h.state !== 'released');
  if (!hold) return notFound();
  if (hold.owner !== buyer) return notFound();
  return { status: 200, body: JSON.stringify(hold), headers: { 'content-type': 'application/json' } };
}
