/** A seat key the box office cannot read. */
export class SeatKeyError extends Error {}

/** A limit or price outside what the box office allows. */
export class OutOfRangeError extends Error {}
