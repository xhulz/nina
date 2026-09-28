<!-- nina:slot pii.1 -->
- Check for privacy regressions: **no sensitive value in a log, an error message, a URL or a test fixture**, per the categories in `.claude/architecture.md` § *Privacy*; document bytes only in the object store, never plaintext in the database; no leaked secret.

<!-- nina:slot pii.2 -->
- **privacy** — the privacy check above, in full: no sensitive value in a log, an error message, a
  URL or a test fixture; document bytes only in the object store; no leaked secret. Where
  **tenant-and-privacy** is dispatched, its reviewer owns this too and there is no separate one; where
  it is not, this is a dimension of its own. Either way it is never nobody's.
