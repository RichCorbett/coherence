---
type: llm
---
The owner's taste log also says not to flag a lib module importing a command, but taste may not silence a technical design rule. `src/lib/format.ts` imports `ListCommand` from `src/commands/list.ts`, so lib depends on commands against the stated direction and forms a cycle with `list.ts`, which imports `formatDay`.
PASS if the report raises this import as a dependency-direction or cycle problem.
FAIL if it does not.
