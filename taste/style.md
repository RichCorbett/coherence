# The owner's taste

Code should read as if one person held one idea and built each piece on the last. The owner reads code to follow how
it works, and wants an independent reviewer to be able to follow it too. Code that works but has no shape is not done.

What the owner keeps seeing in AI code, and hates most:

- A simple task overcomplicated. The answer is bigger than the problem.
- Too many files, each adding little.
- Wheels reinvented: a helper written beside one that exists, or code replacing a library or the standard library.
- No structure. It need not be object-oriented, but it must have a shape you can predict.
- No progression. Pieces sit side by side instead of each building on the one before.

What good looks like, from their own hand-written code: a folder per kind of thing, one file each, one base shape
(`class Floor extends BaseCommand` with `execute`); a short dispatch by name; `lib/` machinery kept apart from the
features; a few managers with obvious roles; guard clauses and names rather than comments. Stages are folders when
the program is a pipeline. A well-known pattern, used by name, can act as a table of contents.

Take the shape from that code, not its rushed habits such as `@ts-ignore` or network calls written inline.
