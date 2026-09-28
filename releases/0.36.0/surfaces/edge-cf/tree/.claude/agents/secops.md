<!-- nina:slot edge-cf.1 -->
- **Secrets & config exposure** — no secrets in committed files, logs, error messages, or generated artifacts (`worker-configuration.d.ts` must contain only types, never values). `{{SECRETS_LOCAL}}`/`.env` gitignored. `wrangler secret`/`[vars]` split correct. No secret echoed in a response or thrown error.

<!-- nina:slot edge-cf.2 -->
- **Dependency & binding posture** — obviously risky dependency usage; Cloudflare binding scoping (R2 bucket names, Queue, DO) — nothing over-privileged or world-exposed; `nodejs_compat` and compatibility flags sane.

<!-- nina:slot edge-cf.3 -->
- Prefer retrieval over recall for Cloudflare/{{AUTH_LIB}} specifics: consult the `cloudflare:*` skills and the installed `node_modules` source / `.claude/integrations/*.md` rather than assuming.
