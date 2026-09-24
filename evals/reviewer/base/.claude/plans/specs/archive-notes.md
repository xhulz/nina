# Spec: archive a note

## Goal
An owner can archive one of their notes. Archiving is idempotent: archiving a note that is already
archived leaves it archived, and still returns 200.

## Files to touch
- `src/server/data/notes.ts` — modify: add `setArchived(id, archived)`, returning the updated row.
- `src/server/services/notes.ts` — modify: add `archiveNote(ownerId, id)`, owner-scoped exactly like
  `getNote`, returning the updated `Note` with its date already formatted.
- `src/server/routes/notes.ts` — modify: add `archiveNoteRoute(ownerId, id)` for
  `PATCH /notes/:id/archive` — 200 with the note; 404 when the note does not exist or is not the
  owner's.
- `src/server/services/notes.test.ts` — modify: tests for archiving, each naming the mutation that
  turns it red.
- `src/server/services/legacy-archive.ts` — delete.

## Out of scope
Every other file, `src/server/config.ts` included.

## Obsolescence list
- `src/server/services/legacy-archive.ts` and its export `legacyArchive` are dead once `archiveNote`
  exists. Delete the file.

## Layering
Route → Service → Data. The route calls the service only. The service owns the owner check, the date
formatting and the named errors.

## Premises
- `findNote` returns `undefined` for an unknown id — `src/server/data/notes.ts`.

## Preview deploy plan
None: this change is not deployed on its own.
