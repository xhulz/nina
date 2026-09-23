<!-- nina:slot pii.1 -->
- Check for privacy regressions: **no sensitive value in a log, an error message, a URL or a test fixture**, per the categories in `.claude/architecture.md` § *Privacy*; document bytes only in the object store, never plaintext in the database; no leaked secret.
