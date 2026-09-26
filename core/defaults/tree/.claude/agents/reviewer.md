<!-- nina:slot project.1 -->
description: Use after the implementer produces a diff, in the same message as every gate the diff triggered. Audits the diff against the architect's spec, runs typecheck, lint and build (never the tests, which qa runs after approval), and names every gate the diff triggers, which run beside it; qa waits for all of them. Returns APPROVED or REJECTED. Read-only, never fixes.
<!-- nina:slot project.3 -->
