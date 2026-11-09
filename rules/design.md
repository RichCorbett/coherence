# How code must be designed

- **One voice.** The same problem is solved the same way everywhere. Before writing any helper, search the repo, its dependencies and the standard library. Reuse what exists; never write a second one beside it.
- **Few concepts.** A handful of ideas, reused, rather than a new noun for each case.
- **Organized by how it works,** not by how it was specified or the order it was built in. Name the stages of the flow and give each one a module (a folder) with one job. The folder tree should read as the flow; never a flat folder of dozens of files.
- **Similar things are built the same way.** Read a few and you can predict the next; adding one is obvious. The problem picks the form, and these are ideas rather than a template to copy.
- **Plumbing stays apart from what the app does,** so feature code reads as the domain.
- **Dependencies go one way** between modules, in a stated layer order, with no cycles, type-only ones included. Modules import each other through their public entry. A type lives with the module that produces the data, never with one that reads it.
- **Names say what a thing does,** and no two names overlap (not `intake`, `intake-pass` and `ingest` side by side).
- **Don't overcomplicate.** No file that only makes sense beside another (merge it), no abstraction without two real uses, no configuration nobody changes. A simple task stays simple: if the solution is bigger than the problem, cut it. A new file needs a reason you can state in one sentence. Use a well-known pattern by name where it fits.
- **Write to be read.** The important thing comes first. Guard clauses, then the work, top to bottom. Edge cases don't crowd out the main path. Short files, and names over comments.
- **Comments explain why, in plain words.** A spec or ticket reference can follow the explanation, never replace it. Don't restate the code.
