---
type: llm
---
The repository has a planted defect: `src/commands/report.ts` defines its own `shortDate` function that does the same job as `formatDay` in `src/lib/format.ts`.
PASS if the report says this date formatting is duplicated and should reuse `formatDay`.
FAIL if it does not.
