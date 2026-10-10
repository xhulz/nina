<!-- nina:slot d1.1 -->
| `cloudflare:cloudflare` | D1's limits, its binding's API, `wrangler d1` migrations |

<!-- nina:slot d1.2 -->
- **On D1, migration safety is about table redefinitions, not locks.** SQLite cannot alter a column, so many changes are drafted as a redefinition: a new table, a copy, `DROP TABLE` of the old one, a rename. Under the local emulator `PRAGMA foreign_keys=OFF` had no effect, so that `DROP TABLE` fired every `CASCADE` and `SET NULL` pointing at the table, exited 0 and left `foreign_key_check` clean, and `PRAGMA defer_foreign_keys=on` did not stop it. Until production D1 shows otherwise, hold every migration to:
   - no redefinition of a table that holds data;
   - foreign keys `RESTRICT` or `NO ACTION`, so a redefinition that would destroy rows fails instead. A `CASCADE`, `SET NULL` or `SET DEFAULT` the architecture keeps is named there with its reason, and every migration that redefines a table it reaches is tested on rows it would cascade to;
   - `ADD COLUMN` nullable, or NOT NULL with a constant default — with no default, or a non-constant one such as `unixepoch()` or `CURRENT_TIMESTAMP`, it applied to an empty table and failed on one with rows under the emulator — and an added `REFERENCES` column nullable with no default, which SQLite requires while foreign keys are on;
   - a redefinition's `INSERT … SELECT` naming only columns the old table has: the emulator read an unknown double-quoted name as a string literal and filled every row with it;
   - the migration applied, in a test, to the previous schema holding rows, and a drift test comparing the applied schema (`PRAGMA table_info`, `foreign_key_list`, `index_list`) with the one the code declares.

- **On D1, the SQL you read is the text D1 runs, not the file.** Per wrangler 4.148's source and `--local`: `d1 migrations apply` appends `INSERT INTO d1_migrations (name) values ('<file>');` to the text, so a last statement with no `;` merges with it and the deploy fails while the tests, which bind that insert apart, pass; locally, text holding `BEGIN TRANSACTION` loses its first `BEGIN TRANSACTION;` and first `COMMIT;` wherever they stand, comments and strings included; `--remote` hands the text whole to D1's server, whose splitter nobody outside Cloudflare can read; and SQLite reads `$name(…)`, `:name(…)`, `@name(…)` and `#name(…)` as one token that swallows quotes, `--` and `;`. Refuse a migration holding `BEGIN TRANSACTION`, `COMMIT;` or `[$@:#]name(` outside a string or comment, or whose last statement lacks its `;`. A script that gates migrations is checked differentially against wrangler's own trim and split and SQLite's tokenizer, never a model of one stage.

<!-- nina:slot d1.3 -->
- **On D1, every query holds to `.claude/patterns.md` § *D1*:** an atomic change is one batch, a conditional write carries its guard in SQL, and no statement binds more than 100 parameters. A list lookup "batched" past that limit is an N+1 fix that fails once the list grows.
