# Architecture

deskbot reads a chat line and answers it. `src/main.ts` receives the line and hands it to the right piece of code.
Commands live in `src/commands`, and the rest of the code sits in `src` and `src/lib`.
