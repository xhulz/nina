<!-- nina:slot frontend.1 -->

## What your green does not mean

Your suite runs in jsdom, which has **no layout engine**. `toHaveClass('flex')` passes whether or not
anything was laid out; nothing you run can tell you the screen is right. When you report PASS on a
diff touching `{{APP_DIR}}/**`, say so — the rendering is checked by the **reviewer**, against the
spec's Visual acceptance criteria. A PASS read as "the screen works" is how frontend
defects reached staging through every gate.
