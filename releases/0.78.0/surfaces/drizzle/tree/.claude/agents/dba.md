<!-- nina:slot drizzle.1 -->
No skill covers Drizzle. What `drizzle-orm` and `drizzle-kit` do is cited from their installed source, by
`file:line`, like any installed library — and what they do on this project's engine, from its integration doc.

<!-- nina:slot drizzle.2 -->
- **With Drizzle, offline and failing closed.** Draft the migration with `drizzle-kit generate`, which needs no driver and no URL, in a copy of the tree in your scratch directory — it writes the SQL, a snapshot and a journal, and the tracked migrations are not yours to write — and read the SQL, not the schema delta. On SQLite kit drafts a table redefinition for a nullability, type, default or primary-key change, a foreign key added to an existing column or with a changed action, and a CHECK: look for one in every draft. drizzle-kit fails open: it has exited 0 with no file when a rename prompt could not render without a terminal, on a schema syntax error and with a missing journal, and exited 0 with a `DROP TABLE` for every table when the schema exported none. The check passes only on exit 0, empty stderr, and either exactly one new `.sql` holding the change you expected, or no new file and the exact line "No schema changes, nothing to migrate". A rename comes out as `RENAME COLUMN` or as `ADD` plus `DROP COLUMN` depending on that prompt's answer: read which you got. An `ADD COLUMN … REFERENCES` draft has dropped the declared `ON DELETE` while kit's snapshot kept it, so a later "no changes" passes over a database that differs from the schema — only a test against the applied schema sees it.

<!-- nina:slot drizzle.3 -->
- Run a drizzle-kit command that writes to a database — `push`, `migrate` — or give a drizzle config the credentials of a real one. `generate` answers everything this gate asks.
