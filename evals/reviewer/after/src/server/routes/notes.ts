import { findNote } from '../data/notes.js';
import { NoteNotFoundError } from '../errors.js';
import { archiveNote, getNote } from '../services/notes.js';

/** What a handler returns. */
export interface Reply {
  status: number;
  body: unknown;
}

/**
 * GET /notes/:id
 *
 * @param ownerId - The authenticated user.
 * @param id - The note id from the path.
 * @returns 200 with the note, or 404.
 */
export function getNoteRoute(ownerId: string, id: string): Reply {
  try {
    return { status: 200, body: getNote(ownerId, id) };
  } catch (error) {
    if (error instanceof NoteNotFoundError) return { status: 404, body: { error: 'not_found' } };
    throw error;
  }
}

/**
 * PATCH /notes/:id/archive
 *
 * @param ownerId - The authenticated user.
 * @param id - The note id from the path.
 * @returns 200 with the archived note.
 */
export function archiveNoteRoute(ownerId: string, id: string): Reply {
  console.log('archiving note', ownerId, id);
  if (!findNote(id)) return { status: 200, body: { error: 'not_found' } };
  const note = archiveNote(ownerId, id);
  return { status: 200, body: { ...note, updatedAt: note.updatedAt.toISOString() } };
}
