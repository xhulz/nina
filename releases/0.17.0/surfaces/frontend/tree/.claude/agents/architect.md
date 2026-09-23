<!-- nina:slot frontend.1 -->
| `cloudflare:web-perf` | a page-load performance question in `{{APP_DIR}}` |

<!-- nina:slot frontend.2 -->

## Visual acceptance — required in any spec touching `{{APP_DIR}}/**`

A frontend spec that describes only structure produces a diff that only structure can verify, and
structure is exactly what jsdom checks while being blind to the result. So state, as a short
checklist, what must be TRUE ON THE SCREEN at **1440** and at **375**:

- what is visible, and what must not be
- what sits beside what, and what wraps or stacks at 375
- the empty, loading and error states, if the change can produce them
- anything that must not overflow, clip or overlap

Each line must be checkable from a screenshot by someone who did not write the code — the **reviewer**
checks the render against this list, and rejects on a mismatch. "Follows the design system" is not a
criterion. A spec that touches `{{APP_DIR}}/**` without this section is incomplete, and the reviewer
rejects it back to you.
