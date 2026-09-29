<!-- nina:slot edge-cf.1 -->
- **`cloudflare:wrangler`** — before running ANY `wrangler` command or reading `wrangler.toml`.
  CLI flags and config fields churn between minor versions; pre-trained knowledge is stale.

<!-- nina:slot edge-cf.2 -->
- **`cloudflare:cloudflare`** — when the deploy touches R2, KV, Queues or Durable Object bindings.

<!-- nina:slot edge-cf.3 -->
- **Both targets, or neither.** A change to the API surface needs the **staging Worker** (`wrangler deploy --env staging`) *and*, where the project has one, the frontend's **Pages** deploy (`{{PAGES_PROJECT}}`). Deploying the frontend alone against an old API is the failure that renders new fields as "—". State explicitly which targets this change requires and why.

<!-- nina:slot edge-cf.4 -->
- **Secret and variable parity.** Everything the new code reads via `env.*` exists in the target environment (`wrangler secret list`). A missing secret fails at request time, not at deploy time.

<!-- nina:slot edge-cf.5 -->

## Pages: which branch, and why it matters

`{{PAGES_PROJECT}}` is a **direct-upload** Pages project whose production branch is `main`. `wrangler pages
deploy` decides production vs preview purely from `--branch`:

- **Staging FE** → `--branch staging`. A preview deployment on its own URL. Production is untouched,
  and this is the FE half of the staging pair with `{{API_STAGING}}`.
- **Production FE** → `--branch main`. Only with an explicit go from {{OWNER}}, per the rule above.

Deploying staging with `--branch=main` is a production deploy wearing a staging label — the
permission classifier is right to stop it. Use the staging branch and the block disappears, because
the block was correct.

**A variable the bundle reads must be in the environment of the build command.** `[vars]` and
`[env.*.vars]` in `{{APP_DIR}}/wrangler.toml` do NOT reach the build — a bundler inlines them at build
time, and Pages vars apply at runtime to a project that has no server. A missing one ships a blank page
with no error.
