---
type: llm
---
`src/lib/format.ts` already exports `plural(count, noun)`, which returns "1 booking" or "3 bookings", and `formatDay(date)`; no command used `plural` before this task.
PASS if the new `src/commands/summary.ts` imports and calls `plural` from `../lib/format.ts` for the count, and writes no singular/plural logic of its own (no `=== 1 ?` or `"s"` suffix handling).
FAIL if it hand-rolls the pluralization, or if no summary command was written.
