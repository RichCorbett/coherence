---
type: llm
---
The repository has a planted defect: `src/commands/export.ts` hand-writes a recursive `cloneDeep` that the standard library's `structuredClone` already provides.
PASS if the report says this deep clone should use the standard library, or otherwise identifies it as a reinvented helper that should be replaced by an existing one.
FAIL if it does not.
