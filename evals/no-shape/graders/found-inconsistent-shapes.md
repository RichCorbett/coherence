---
type: llm
---
The repository has a planted defect: the commands are each built differently - `PingCommand` is a class in `src/commands/ping.ts`, `listBookings` is a plain function in `src/commands/list.ts`, `report` is an object literal in `src/commands/report.ts`, and `export` is written inline in the switch in `src/main.ts`.
PASS if the report says the commands have no common shape and should follow one pattern.
FAIL if it does not.
