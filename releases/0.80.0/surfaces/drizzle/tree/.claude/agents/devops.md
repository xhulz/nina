<!-- nina:slot drizzle.1 -->
- **Drizzle migrations go out through the one runner the architecture names**, as the SQL files the database gate read, and nothing else changes a shared database's schema.

<!-- nina:slot drizzle.2 -->
- Run `drizzle-kit push` against a shared database. It applies the schema without a migration file, so no gate read what it did.
