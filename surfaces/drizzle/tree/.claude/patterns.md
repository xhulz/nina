<!-- nina:slot drizzle.1 -->

### Drizzle

- Tables are declared in one schema module per storage backend, and only there.
- A database error does not leave the data layer as Drizzle threw it: a failed query's error carries the SQL and every bound value, in its message and as properties, so logging or serializing it publishes them. `logger: true` logs every parameter too.
- Tests run a real Drizzle client against the real engine or its local emulator; the client is never mocked.
