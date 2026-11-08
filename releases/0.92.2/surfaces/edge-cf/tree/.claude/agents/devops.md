<!-- nina:slot edge-cf.1 -->
- **`cloudflare:wrangler`** — before running ANY `wrangler` command or reading the wrangler config.
  CLI flags and config fields churn between minor versions; pre-trained knowledge is stale.

<!-- nina:slot edge-cf.2 -->
- **`cloudflare:cloudflare`** — when the deploy touches R2, KV, Queues or Durable Object bindings.

<!-- nina:slot edge-cf.3 -->
- **Every target the change reaches, or none.** A change to the API surface deploys the Worker's staging or preview, and — where the frontend deploys apart from it, as a Pages project or a Worker of its own — the frontend's too. Deploying a frontend alone against an old API is the failure that renders new fields as "—". Where one Worker serves the API and the frontend as static assets, the two are one deploy. State which targets this change requires and why.

<!-- nina:slot edge-cf.4 -->
- **Secret and variable parity.** Everything the new code reads via `env.*` exists in the target environment (`wrangler secret list`). A missing secret fails at request time, not at deploy time.

<!-- nina:slot edge-cf.5 -->
- **A variable the frontend bundle reads is in the environment of its build command.** The wrangler config's `vars` reach a Worker at runtime and never a bundler, which inlines what it reads at build time. A missing one ships a blank page with no error.

## A frontend on Pages: which branch, and why it matters

Only where the frontend deploys as a Pages project of its own; a Worker that serves it as static assets has no
branch to choose. A **direct-upload** Pages project whose production branch is `main` goes to production or
to preview by `wrangler pages deploy --branch` alone:

- **Staging FE** → `--branch staging`. A preview deployment on its own URL. Production is untouched,
  and this is the FE half of the staging pair with the Worker's staging.
- **Production FE** → `--branch main`. Only with an explicit go from {{OWNER}}, per § *Production*.

Deploying staging with `--branch=main` is a production deploy wearing a staging label — the
permission classifier is right to stop it. Use the staging branch and the block disappears, because
the block was correct.
