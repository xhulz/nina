<!-- nina:slot frontend.1 -->

---

## Frontend (Vite + React) conventions

- React **function components, hooks only**. No class components.
- **TanStack Query for all server state.** Never fetch in `useEffect`.
- **shadcn/ui + Tailwind** for styling. No CSS modules, no styled-components, no Emotion.
- **Single-app layout:** `{{APP_DIR}}` serves all roles (`user`, `admin`) with a role-aware sidebar. Routes live in `{{APP_DIR}}/src/routes/`.
- **Reusable UI and utilities belong in `packages/web-shared` (`{{PKG_SCOPE}}/web-shared`)** when they are stable cross-cutting primitives: `apiFetch`, {{AUTH_LIB}} client, hooks (`useAuth`, `useMe`, `useAccount`, etc.), `AuthGuard`, all shadcn `ui/*`, `formatBrl`/`parseBrl`, test helpers, the Tailwind preset.
  - Import shadcn primitives from `{{PKG_SCOPE}}/web-shared/components/ui/<name>`.
  - Import `formatBrl` / `parseBrl` from `{{PKG_SCOPE}}/web-shared/lib`.
- **App-specific UI stays in `{{APP_DIR}}/src/components/`** when not consumed elsewhere.
- No global state libs unless genuinely global (auth user, active account). Prefer URL state and TanStack Query cache.
