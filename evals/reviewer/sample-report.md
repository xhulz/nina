VERDICT: REJECTED
ISSUES: owner-check-missing, archive-toggles, out-of-scope-config, legacy-not-deleted

The line after ISSUES: the implementer owns every fix.

- `src/server/services/notes.ts:43` — `archiveNote` checks that the note exists but not that it is the owner's; anyone can archive anyone's note. Add the owner check `getNote` has.
- `services/notes.ts:45` — `setArchived(id, !row.archived)` toggles: archiving an archived note unarchives it, and the spec says archiving is idempotent.
- `src/server/config.ts` — `PAGE_SIZE` changed; the spec puts this file out of scope.
- `src/server/services/legacy-archive.ts` — the obsolescence list says delete it; it is still here.
- `src/server/routes/notes.ts:30` — the JSDoc says only 200; a sentence about the 404 would help.

Tests: the new test names no mutation.
Artifacts checked: the spec's file list against the tree.
