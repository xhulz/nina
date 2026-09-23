# Patterns & Conventions

Read this before writing code. Architects cite it in specs; implementers follow it; reviewers enforce it.

---

## Language & tooling

- **TypeScript strict mode** everywhere. No `any` without a justifying comment.
- **pnpm workspaces + Turborepo**. Never `npm` or `yarn`. Use `turbo run <task>` for orchestrated work.
- **Biome** for format + lint. No ESLint / Prettier.
- **Vitest** for unit tests. **Miniflare** for Worker integration tests.
- **Zod** for runtime validation at all trust boundaries (API ingress, env loading, queue payload, DO RPC, webhook body, integration responses).

### Relative imports carry a `.js` extension — this is intentional, do NOT "fix" it

Relative imports in `.ts`/`.tsx` source MUST use the `.js` extension (e.g. `import { x } from './client.js'`, never `'./client'` or `'./client.ts'`). This looks wrong but is correct ESM-TypeScript and is load-bearing:

- The repo is ESM (`"type": "module"`, `module: ESNext`, `moduleResolution: Bundler`, `verbatimModuleSyntax: true` in `packages/tsconfig/base.json`). **TypeScript never rewrites import specifiers** — what you write is what lands in the emitted `.js`.
- Emitting packages ({{EMITTING_PKGS}}) compile with `tsc` to real `.js` in `dist/` and are consumed via their `exports` map (`./dist/*.js`). At runtime the file IS `client.js`; a source `'./client.ts'` would emit a dead `'./client.ts'` reference → broken import. The `.js` form is the only one that works for these.
- Bundled apps (`{{API_DIR}}` via wrangler/esbuild, `{{APP_DIR}}` via Vite) resolve `'./x.js'` back to `./x.ts` source transparently, so the same convention works everywhere.
- Switching to `.ts` extensions would require `allowImportingTsExtensions`, which only works with `noEmit` — it would break every emitting package. Do not propose it.

This is the official TypeScript guidance for ESM. A reviewer/AI that "corrects" `.js` → `.ts` (or strips the extension) is introducing a bug, not a cleanup.

---

## Folder structure within a TS package

```
package/
├── src/
│   ├── index.ts          # public exports only — this is the package API
│   ├── internal/         # not re-exported; no deep imports allowed from outside
│   └── types.ts          # shared types
├── test/                 # *.test.ts mirroring src/ structure
└── package.json
```

- External code imports from `{{PKG_SCOPE}}/<name>` (barrel `index.ts`), never `{{PKG_SCOPE}}/<name>/src/internal/...`.

---

## `export` only what crosses a module boundary

**`export` is a claim that something outside this file needs the symbol.** If nothing does, drop the
keyword — the declaration stays, it just stops pretending to be API.

This is not cosmetic. An unused export is invisible to every tool we have: TypeScript's
`noUnusedLocals` and Biome's `noUnusedVariables` both stop at the file boundary, so an exported dead
symbol is the one kind of dead code nothing flags. It also makes the symbol look load-bearing to the
next reader, which is how a second implementation gets written next to the first.

- A React component's `Props` type used only by that component is **not** exported. Export it only
  when another module actually imports it.
- The same goes for a service's internal result/input shapes, an error code union that never leaves
  its module, and a constant only its own file reads.
<!-- nina:slot project.1 -->
- The standing report is `.claude/code-map.generated.md` § *Rot signals* (`pnpm code-map`). The
  reviewer checks it for symbols the current diff introduced: **a new export nothing consumes is
  dead on arrival.**

---

## Naming

- **Files:** `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- **Types / interfaces:** `PascalCase`. No `I` prefix.
- **Functions / vars:** `camelCase`.
- **Constants:** `SCREAMING_SNAKE_CASE` only for true compile-time constants.
- **Env vars:** `SCREAMING_SNAKE_CASE`, loaded through a typed `env.ts` with Zod validation.
<!-- nina:slot db.1 -->
<!-- nina:slot money.1 -->
<!-- nina:slot money.2 -->
<!-- nina:slot money.3 -->

---

## API (Cloudflare Worker / Hono) conventions

### Layering: Route → Service → Data Objects

Every request (and queue/webhook invocation) traverses three layers in order. **No layer may skip the next.** Full diagram in `.claude/architecture.md`.

- **Route** (`{{API_DIR}}/src/routes/<resource>.ts`): Zod validation, auth + role extraction, envelope shaping, privacy-safe log, deps construction. Nothing else.
<!-- nina:slot integrations.1 -->
- **Service** (`{{API_DIR}}/src/services/<resource>.ts`): business orchestration, userId scoping, Date→ISO mapping, named-error taxonomy. HTTP-agnostic.
- **Data Objects:** the database client, the platform bindings, and each integration's boundary module.

**Hard rules (reviewer enforces):**

<!-- nina:slot db.2 -->
2. Routes must NOT call `.toISOString()` on service results — services do that.
3. Services must NOT import Hono `Context`, call `c.json`, or reference status codes.
<!-- nina:slot db.3 -->
<!-- nina:slot db.4 -->
<!-- nina:slot money.4 -->
<!-- nina:slot money.5 -->
<!-- nina:slot integrations.2 -->

### Other API rules

- **Zod validation at the request boundary.** No ad-hoc `if (!body.foo) return 400`.
- Response shape is always `{ok: true, data: T} | {ok: false, error: {code, message}}`. No bare throws leaking to clients.
- Custom errors: `class AppError extends Error { code: string; status: number }`. Each route maps known classes to HTTP codes.
<!-- nina:slot money.6 -->
<!-- nina:slot db.5 -->
<!-- nina:slot integrations.3 -->
<!-- nina:slot project.2 -->

---

## SDK / shared package conventions

- **Tree-shakeable:** barrel `index.ts` only re-exports. No side effects at module top level.
- Works in: modern browsers, Node 20+, Workers.
- No `console.log` in production paths. Use a `debug(msg)` helper that's a no-op in prod, and never log PII.
<!-- nina:slot frontend.1 -->

---

## Tests

### Unit tests
- Test **pure functions** directly. No mocks of our own code.
<!-- nina:slot money.7 -->
- Don't test implementation details. Test behavior at the module boundary.

### Integration tests
- **Miniflare** for Worker tests — real Cloudflare runtime, no mocks.
<!-- nina:slot db.6 -->
<!-- nina:slot integrations.4 -->

### Fixtures
<!-- nina:slot project.3 -->

### Test files MUST be inside the typecheck program

A package whose `tsconfig.json` has `include: ["src"]` **does not typecheck its own tests.** That is
a false green, and an expensive one: the test still imports the symbol you deleted and still passes
a fixture whose shape drifted, and you find out at vitest time — or never, if nobody runs that
suite. It is the mechanism behind the pill *test-files-not-typechecked-on-symbol-removal*.
<!-- nina:slot project.4 -->

A package that emits (`build: tsc`, with `rootDir: "src"`) cannot simply add `test` to its build
config. Give it a second config instead and point the script at it:

```jsonc
// tsconfig.typecheck.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "test"]
}
```
```jsonc
// package.json — build keeps using tsconfig.json, typecheck does not
"typecheck": "tsc --noEmit -p tsconfig.typecheck.json"
```
<!-- nina:slot project.5 -->
<!-- nina:slot project.6 -->

---

## TSDoc — required on all TS declarations

Every named declaration gets a TSDoc block (`/** ... */`) — exported or not: functions, classes + members, interfaces + members, type aliases, enums + members, and top-level constants whose name doesn't convey intent.

### Structure
- **First line:** a concise one-sentence summary.
- **`@param`** when the purpose isn't fully encoded in name and type.
- **`@returns`** when the return carries information the type alone doesn't convey.
- **`@throws`** whenever the function can throw — name the error type and condition.
- **`@example`** for non-trivially composed APIs.
- **`@remarks`** for invariants, perf trade-offs, caveats.

### What TSDoc is NOT
- Not a restatement of the signature. Not a changelog. Not a crutch for bad naming.

### Enforcement
Reviewer verifies coverage. **Missing TSDoc on any new declaration = request changes.**

---

## Inline comments — default: none

Separate from TSDoc. Regular `//` comments stay rare:
- **Only** for non-obvious **WHY**: an invariant, a subtle perf trade-off, a workaround.
- **Never** for WHAT — if code doesn't read clearly, fix the code.
- **Never** reference callers, tickets, or PR history.
<!-- nina:slot edge-cf.1 -->
<!-- nina:slot project.7 -->
<!-- nina:slot edge-cf.2 -->

---

## Commit / PR conventions

- One logical change per PR. Multi-concern PRs get split by reviewer.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
- PR description answers **why**, not **what**.
- Reviewer verifies: typecheck clean, Biome clean, dba approved (if Prisma touched), integration-tester approved (if an integration boundary was touched), no secret leaked, no PII in logs or tests.
