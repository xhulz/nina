import { findNote, saveNote } from '../data/notes.js';

/**
 * The old archiving path, from before archiving was a field on the note: it marked the body instead.
 * Replaced by `archiveNote` in `services/notes.ts`.
 *
 * @param id - The note to archive.
 */
export function legacyArchive(id: string): void {
  const row = findNote(id);
  if (row) saveNote({ ...row, body: `[archived] ${row.body}` });
}
