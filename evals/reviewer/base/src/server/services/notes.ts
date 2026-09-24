import { findNote } from '../data/notes.js';
import { NoteNotFoundError } from '../errors.js';

/** A note as the API returns it. */
export interface Note {
  id: string;
  body: string;
  archived: boolean;
  updatedAt: string;
}

/**
 * Reads one of the owner's notes.
 *
 * @param ownerId - The user asking.
 * @param id - The note id.
 * @returns The note.
 * @throws NoteNotFoundError when the note does not exist or is not the owner's.
 */
export function getNote(ownerId: string, id: string): Note {
  const row = findNote(id);
  if (!row || row.ownerId !== ownerId) throw new NoteNotFoundError(id);
  return { id: row.id, body: row.body, archived: row.archived, updatedAt: row.updatedAt.toISOString() };
}
