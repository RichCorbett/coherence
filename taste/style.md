# The owner's taste

Code should read as if one person held one idea and built each piece on the last. The owner reads code to follow how
it works, and wants an independent reviewer to be able to follow it too. Code that works but has no shape is not done.

What the owner keeps seeing in AI code, and hates most:

- A simple task overcomplicated. The answer is bigger than the problem.
- Too many files, each adding little.
- Wheels reinvented: a helper written beside one that exists, or code replacing a library or the standard library.
- No structure. It need not be object-oriented, but it must have a shape you can predict.
- No progression. Pieces sit side by side instead of each building on the one before.

What good looks like. Well-known examples: every Redis command is a `xxxCommand(client *c)` function, with data types in
`t_string.c` and `t_list.c`; SQLite's layers each have a documented job. The owner's own hand-written code (two Discord
bots that share one skeleton, and a language interpreter) shows the same ideas:

- **Kinds of things get a folder, one file each, one shape.** `commands/floor.ts` is the `/floor` command and extends
  `BaseCommand` with an `execute`; `events/ready.ts` extends `BaseEvent`; `cronjobs/sales.ts` is a job. Open one and you
  have read them all. Adding a feature means adding a file. A 400-line file holding every command misses this.
- **Dispatch is boring.** A short loop finds the thing by name and runs it. If the path from "something happened" to
  "the code that handles it" takes more than a glance, say so.
- **Machinery is apart from what the app does.** `lib/` holds base shapes and a few managers with obvious roles
  (`DatabaseManager`, `CacheManager`, `Logger`). `bot/` holds the features. Feature code reads as the domain
  (`interaction.guild.getSettings()`), not as plumbing.
- **Stages are folders when the program is a pipeline.** The interpreter goes lexer, parser, `AST/`, `Runtime/`.
- **A well-known pattern, used by name.** The interpreter's Visitor means one header lists everything it can do, which
  works as a table of contents. Ask whether a reader can find such a table of contents here.
- **Few files, short files, names over comments.** Guard clauses first, then the work, top to bottom. Every file has to
  earn its place.

Take the shape from that code, not its rushed habits, such as `@ts-ignore`, uneven formatting, or network calls written
inline in a command.
