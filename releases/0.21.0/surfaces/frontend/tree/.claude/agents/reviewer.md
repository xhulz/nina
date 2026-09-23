<!-- nina:slot frontend.2 -->
- **If the diff touches `{{APP_DIR}}/**`: the spec must carry a Visual acceptance section, and you check the render against it — see *Visual gate* below.** No section → REJECT upstream to the architect.

<!-- nina:slot frontend.3 -->
- `pnpm build` for the affected frontend packages (`{{APP_DIR}}`)

<!-- nina:slot frontend.4 -->
## Visual gate — you are the stage that looks at the screen

Deciding whether a screen is right is review, not operations, and it belongs here. qa runs vitest in
jsdom, which has **no layout engine**: `toHaveClass('flex')` passes whether or not a single pixel
landed anywhere. Every gate before you reads text. This is why backend work lands first time through
this pipeline and frontend work does not — the frontend defects were never expressible as a test.

For any diff touching `{{APP_DIR}}/**`:

1. Build and serve it — you already run `pnpm build` for frontend diffs; serve that build locally.
   Every protected screen redirects to `/login` without a session, so a plain static server
   screenshots the login page. Use `scripts/visual-fixture-server.mjs`, which serves the built
   `dist` AND a canned API from ONE origin (no auth, no DB, no Worker):

   ```bash
   export PATH=/opt/homebrew/opt/node@22/bin:$PATH
   cd {{APP_DIR}} && VITE_API_BASE_URL=http://localhost:5199 npx vite build --outDir /tmp/dist-vis
   node ../../scripts/visual-fixture-server.mjs /tmp/dist-vis 5199
   ```

   `VITE_API_BASE_URL` must match the fixture's origin at BUILD time — Vite inlines it, and a
   mismatch ships a screen that renders but fetches nothing. The fixture logs `UNSTUBBED: <path>`
   for any endpoint it does not know; add a handler there rather than screenshotting a broken
   screen. `FIXTURE_EMPTY=1` switches list endpoints to `[]` to exercise empty states, and
   `FIXTURE_ERROR=<CODE>` fails every write with that error code so an error state is
   reachable at all — otherwise reaching one means finding real data that collides, which
   usually means you cannot reach it.
2. `browser_navigate` to the changed screen. Screenshot at **1440** and at **375**
   (`browser_resize` first — the viewport resets to a narrow default across navigations, so
   resize AFTER navigating and confirm the width in the screenshot before you judge it).

   Many screens are not reachable by URL. Tabs on `/identification` and `/settings` are local
   React state, never reflected in the route, so `browser_click` is the ONLY way in — a
   navigate-and-screenshot lands on the default tab and proves nothing about the changed one.
2b. **Measure, do not squint.** `browser_evaluate` turns "looks fine" into a number, and an
   overflow you can measure is one you can attribute. To decide whether horizontal scroll is
   yours or pre-existing, measure `document.documentElement.scrollWidth` vs `clientWidth` on
   the changed screen AND on an untouched one (`/dashboard`) — and, when it matters, build the
   parent commit into a second dist and measure both. Reporting a pre-existing app-wide defect
   as a regression wastes a cycle; excusing a real one as "probably pre-existing" ships it.
3. Check each screenshot against the spec's **Visual acceptance** list, item by item. Not "looks
   fine" — the specific claims the spec made.
4. `browser_console_messages`. An error there is a defect even when the page renders.

A screen that contradicts the spec is `REJECTED`, with the screenshot and what is wrong in it. Say in
your report which widths you looked at; a frontend approval that does not mention having looked is
the failure this section exists to end.

<!-- nina:slot frontend.1 -->
, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_resize, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_snapshot, mcp__plugin_playwright_playwright__browser_console_messages, mcp__plugin_playwright_playwright__browser_click, mcp__plugin_playwright_playwright__browser_evaluate, mcp__plugin_playwright_playwright__browser_close

<!-- nina:slot frontend.5 -->
- **visual** — the spec's Visual acceptance section exists and the render matches it (see *Visual gate*).
  A reviewer checking only another dimension skips it, so it is its own: owned by **patterns-and-scope**
  when no visual reviewer is dispatched, and never nobody's.
