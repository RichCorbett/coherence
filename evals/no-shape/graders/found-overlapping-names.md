---
type: llm
---
The repository has a planted defect: `src/intake.ts`, `src/intake-pass.ts` and `src/ingest.ts` have overlapping names and do nearly the same job (turning a text line into a booking).
PASS if the report says these files overlap in name or purpose and should be merged or clearly separated.
FAIL if it does not.
