/** A note that does not exist, or that belongs to someone else. */
export class NoteNotFoundError extends Error {
  /**
   * @param id - The note that was asked for.
   */
  constructor(id: string) {
    super(`note ${id} not found`);
    this.name = 'NoteNotFoundError';
  }
}
