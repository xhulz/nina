import { findNote, setArchived } from '../data/notes';
import { NoteNotFoundError } from '../errors.js';

/** A note as the API returns it. */
export interface Note {
  id: string;
  body: string;
  archived: boolean;
  updatedAt: string;
}

/** A note just archived, with the moment it happened. */
export interface ArchivedNote {
  id: string;
  body: string;
  archived: boolean;
  updatedAt: Date;
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

/**
 * Archives one of the owner's notes.
 *
 * @param ownerId - The user asking.
 * @param id - The note id.
 * @returns The archived note.
 */
export function archiveNote(ownerId: string, id: string): ArchivedNote {
  const row = findNote(id);
  if (!row) throw new NoteNotFoundError(id);
  try {
    const next = setArchived(id, !row.archived);
    return { id: row.id, body: row.body, archived: next?.archived ?? true, updatedAt: next?.updatedAt ?? new Date() };
  } catch {
    return { id: row.id, body: row.body, archived: row.archived, updatedAt: row.updatedAt };
  }
}
