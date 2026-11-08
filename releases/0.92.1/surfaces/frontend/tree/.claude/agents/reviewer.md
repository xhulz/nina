<!-- nina:slot frontend.2 -->
- **If the diff touches `{{APP_DIR}}/**`: the spec — or the dispatch, in a chain with no architect — must carry a Visual acceptance section, and you check the render against it — see *Visual gate* below.** No section → REJECT upstream to whoever wrote it.

<!-- nina:slot frontend.3 -->
- `{{BUILD_CMD}}` for the affected frontend packages (`{{APP_DIR}}`)

<!-- nina:slot frontend.4 -->
## Visual gate — you are the stage that looks at the screen

Deciding whether a screen is right is review, not operations, and it belongs here. qa runs vitest with
**no layout engine**, in jsdom or rendering to a string: `toHaveClass('flex')` passes whether or not a single pixel
landed anywhere. Every gate before you reads text. This is why backend work lands first time through
this pipeline and frontend work does not — the frontend defects were never expressible as a test.

For any diff touching `{{APP_DIR}}/**`:

1. Build and serve it the way this project serves a build for review:

   ```bash
   {{VISUAL_SERVE}}
   ```

   Where screens sit behind a login, this command is what gets past it: a plain static server
   screenshots the login page. Where the build reaches an API at an address fixed at build time, one
   that does not match what the command serves ships a screen that renders but fetches nothing. A
   request the served build does not answer is a gap in it: send it back naming the request, rather
   than judge a broken screen. It must also reach the empty and error states the change has; a state
   you cannot reach is a state nobody reviewed.
2. `browser_navigate` to the changed screen. Screenshot at **1440** and at **375**
   (`browser_resize` first — the viewport resets to a narrow default across navigations, so
   resize AFTER navigating and confirm the width in the screenshot before you judge it).

   Many screens are not reachable by URL: a tab kept in component state is never in the route, so
   `browser_click` is the ONLY way in — a navigate-and-screenshot lands on the default tab and proves
   nothing about the changed one.
3. **Measure, do not squint.** `browser_evaluate` turns "looks fine" into a number, and an
   overflow you can measure is one you can attribute. To decide whether horizontal scroll is
   yours or pre-existing, measure `document.documentElement.scrollWidth` vs `clientWidth` on
   the changed screen AND on an untouched one — and, when it matters, build `HEAD` into a second
   dist from a worktree (Hard Rule #18) and measure both. Reporting a pre-existing app-wide defect
   as a regression wastes a cycle; excusing a real one as "probably pre-existing" ships it.
4. Check each screenshot against the spec's **Visual acceptance** list, item by item. Not "looks
   fine" — the specific claims the spec made.
5. `browser_console_messages`. An error there is a defect even when the page renders.

A screen that contradicts the spec is `REJECTED`, with the screenshot and what is wrong in it. Say in
your report which widths you looked at; a frontend approval that does not mention having looked is
the failure this section exists to end.

<!-- nina:slot frontend.1 -->
, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_resize, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_snapshot, mcp__plugin_playwright_playwright__browser_console_messages, mcp__plugin_playwright_playwright__browser_click, mcp__plugin_playwright_playwright__browser_evaluate, mcp__plugin_playwright_playwright__browser_close

<!-- nina:slot frontend.5 -->
- **visual** — the spec's Visual acceptance section exists and the render matches it (see *Visual gate*).
  A reviewer checking only another dimension skips it, so it is its own: owned by **patterns-and-scope**
  when no visual reviewer is dispatched, and never nobody's.
