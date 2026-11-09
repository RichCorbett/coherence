---
type: llm
---
The repository has a planted defect: the `greet` command in `src/commands/greet.ts` only returns `hello <name>`, yet it is built on a Strategy interface, a default strategy, a factory, an options type and a config file in `src/greeting/`, each used exactly once.
PASS if the report says the greeting machinery is far bigger than the task, or that these abstractions have only one use.
FAIL if it does not.
