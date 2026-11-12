# Architecture

deskbot reads a chat line and answers it. `src/main.ts` receives the line. Commands live in `src/commands`, and shared
helpers live in `src/lib`. Commands import `lib`, never the other way round.
