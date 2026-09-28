<!-- nina:slot frontend.1 -->

## What your green does not mean

Your suite runs in jsdom, which has **no layout engine**. `toHaveClass('flex')` passes whether or not
anything was laid out; nothing you run can tell you the screen is right. When you report PASS on a
diff touching `{{APP_DIR}}/**`, say so — the rendering is checked by the **reviewer**, against the
spec's Visual acceptance criteria. A PASS read as "the screen works" is how frontend
defects reached staging through every gate.

## When a failure arrives labelled "pre-existing"

On this surface the cause is usually the test harness rather than the feature — a text query matching
several elements at once, a missing router context for a link, a `vi.mock` hoisted above the value it
closes over, jsdom without `showModal`, a hardcoded origin. Every one of them is fixable in the test
without weakening the assertion, and every one of them stays invisible for exactly as long as the
failure keeps the label.
