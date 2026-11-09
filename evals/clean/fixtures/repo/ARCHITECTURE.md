# Architecture

deskbot reads a chat line, finds the command by name and runs it.

`src/main.ts` holds the list of commands and dispatches by name. Each `src/commands/*.ts` file is one command and
extends `BaseCommand` from `src/lib/base-command.ts`. Shared helpers live in `src/lib`. Commands import `lib`, never
the other way round.

One request: the line `report` reaches `dispatch` in `main.ts`, which finds `ReportCommand` and runs `execute`.
