<!-- nina:slot frontend.1 -->
| `{{APP_DIR}}/**` page-load perf audit (LCP/INP/CLS/bundle) | `cloudflare:web-perf` |

<!-- nina:slot frontend.2 -->

### Nothing before devops can see the screen
The reviewer reads a diff. qa runs vitest in jsdom, which has **no layout engine** — `toHaveClass('flex')`
passes whether or not a pixel landed anywhere. Every backend invariant is checkable in text, which is why
the same pipeline lands backend work first time and lets frontend defects through every gate: they were
never expressible as a test.

So any diff touching `{{APP_DIR}}/**` carries a visual contract: the **architect** writes a *Visual acceptance*
checklist (what must be true on screen at 1440 and 375), the **reviewer** rejects an FE spec without one, the
**implementer** looks at its own screen before handing off, and the **reviewer** builds, serves and screenshots it,
rejecting on a mismatch — judging the screen is review, not operations. **devops** only smokes the
deployed preview for a blank page. Browser access is granted through the Playwright MCP `browser_*` tools in those agents'
`tools:` lists — it is not a skill, and an agent without those tools in its list cannot see anything.
