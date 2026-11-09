---
type: llm
---
The repository still has a planted defect the owner did not reject: `src/commands/report.ts` defines `shortDate`, which repeats `formatDay` in `src/lib/format.ts`.
PASS if the report says this date formatting is duplicated and should reuse `formatDay`.
FAIL if it does not.
