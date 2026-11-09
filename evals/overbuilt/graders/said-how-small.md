---
type: llm
---
The repository has a planted defect: the `src/greeting/` folder (about five files) does the work of one trivial command.
PASS if the report says concretely that this could be about one small command file, or a few lines in `src/commands/greet.ts`.
FAIL if it only calls the code overbuilt without saying how small it could be.
