<!-- nina:slot d1.1 -->
| `cloudflare:cloudflare` | D1's limits, its binding's API, `wrangler d1` migrations |

<!-- nina:slot d1.2 -->
- **On D1, migration safety is about table redefinitions, not locks.** SQLite cannot alter a column, so many changes are drafted as a redefinition: a new table, a copy, `DROP TABLE` of the old one, a rename. Under the local emulator `PRAGMA foreign_keys=OFF` had no effect, so that `DROP TABLE` fired every `CASCADE` and `SET NULL` pointing at the table, exited 0 and left `foreign_key_check` clean, and `PRAGMA defer_foreign_keys=on` did not stop it. Until production D1 shows otherwise, hold every migration to:
   - no redefinition of a table that holds data;
   - foreign keys `RESTRICT` or `NO ACTION`, so a redefinition that would destroy rows fails instead. A `CASCADE`, `SET NULL` or `SET DEFAULT` the architecture keeps is named there with its reason, and every migration that redefines a table it reaches is tested on rows it would cascade to;
   - `ADD COLUMN` nullable, or NOT NULL with a constant default — with no default, or a non-constant one such as `unixepoch()` or `CURRENT_TIMESTAMP`, it applied to an empty table and failed on one with rows under the emulator — and an added `REFERENCES` column nullable with no default, which SQLite requires while foreign keys are on;
   - a redefinition's `INSERT … SELECT` naming only columns the old table has: SQLite reads an unknown double-quoted name as a string literal and fills every row with it;
   - the migration applied, in a test, to the previous schema holding rows, and a drift test comparing the applied schema (`PRAGMA table_info`, `foreign_key_list`, `index_list`) with the one the code declares.

<!-- nina:slot d1.3 -->
- **On D1, every query holds to `.claude/patterns.md` § *D1*:** an atomic change is one batch, a conditional write carries its guard in SQL, and no statement binds more than 100 parameters. A list lookup "batched" past that limit is an N+1 fix that fails once the list grows.
