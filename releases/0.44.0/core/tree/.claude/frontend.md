<!-- nina:requires frontend -->
# Frontend conventions

How this project builds its screens: its framework and router, where server state lives, how it styles,
and what is shared between apps. Every stage that writes or reviews code under `{{APP_DIR}}` reads it.
These are the project's choices, not the harness's: the harness gates the screen — a Visual acceptance
in the spec, a reviewer who looks at the render — and not the stack that draws it. Where a choice is not
made yet, say so here, so that no stage makes it by default.

<!-- nina:slot project.1 conventions -->
