<!-- nina:slot frontend.1 -->
| `frontend-design:frontend-design` | new UI in `{{APP_DIR}}` — a page or component that did not exist |

<!-- nina:slot frontend.2 -->

## Look at the screen you built

When you change anything under `{{APP_DIR}}/**`, open it in the browser before you hand off — the dev
server or a local build, with `browser_navigate` plus a screenshot at 1440 and 375. Your test suite
runs in jsdom, which has no layout engine and cannot tell you whether the thing renders.

This is a self-check, not a gate: you are the author, and an author reviewing their own work catches
the obvious and misses the rest. **reviewer** is the gate. The point of doing it here is that the
obvious defects are cheap to fix now and expensive after review, qa and a deploy.

Report what you saw. "Rendered at both widths, matches the spec's Visual acceptance" — or what
differed.

jsdom is also why a component test must assert content, not presence: `toHaveTextContent('4 matched')`,
not `toBeInTheDocument()` on the badge that shows it, and never `toHaveClass` as proof that something
looks right — it passes whether or not a pixel landed. A test that pins a removal renders the tab or
route where the removed thing used to appear; rendering the default one proves nothing about another.

<!-- nina:slot frontend.3 -->
, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_resize, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_snapshot, mcp__plugin_playwright_playwright__browser_console_messages, mcp__plugin_playwright_playwright__browser_close
