/** A message from the release queue. */
export interface ReleaseMessage {
  /** The queue's id for this delivery. */
  id?: string;
  /** What is released. */
  body: {
    /** The seat. */
    seat: number;
    /** The hold it ends. */
    holdId: string;
  };
}

/** One line of the release log. */
export interface LogLine {
  /** What happened. */
  event: 'released';
  /** The message it came from, so a redelivery can be told apart. */
  messageId: string;
  /** The seat. */
  seat: number;
}

/**
 * Logs a release by its message's id.
 *
 * @param message - The message.
 * @param log - The release log.
 */
export function handleRelease(message: ReleaseMessage, log: LogLine[]): void {
  log.push({ event: 'released', messageId: String(message.id), seat: message.body.seat });
}
