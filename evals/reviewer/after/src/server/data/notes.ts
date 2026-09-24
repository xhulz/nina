/** A note as it is stored. */
export interface NoteRow {
  id: string;
  ownerId: string;
  body: string;
  archived: boolean;
  updatedAt: Date;
}

const rows = new Map<string, NoteRow>();

/**
 * Finds one note by id.
 *
 * @param id - The note id.
 * @returns The row, or undefined when there is none.
 */
export function findNote(id: string): NoteRow | undefined {
  return rows.get(id);
}

/**
 * Stores a note, replacing any row with the same id.
 *
 * @param row - The row to store.
 */
export function saveNote(row: NoteRow): void {
  rows.set(row.id, row);
}

export function setArchived(id: string, archived: boolean): NoteRow | undefined {
  const row = rows.get(id);
  if (!row) return undefined;
  const next = { ...row, archived, updatedAt: new Date() };
  rows.set(id, next);
  return next;
}
