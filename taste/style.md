# The owner's taste

Code should read as if one person held one idea and built each piece on the last. The owner reads code to follow how
it works, and wants an independent reviewer to be able to follow it too. Code that works but has no shape is not done.

What the owner keeps seeing in AI code, and hates most:

- A simple task overcomplicated. The answer is bigger than the problem.
- Too many files, each adding little.
- Wheels reinvented: a helper written beside one that exists, or code replacing a library or the standard library.
- No structure. It need not be object-oriented, but it must have a shape you can predict.
- No progression. Pieces sit side by side instead of each building on the one before.

## What good looks like

These are ideas, not a template. The problem picks the form, and code need not resemble any example here. Classes, a
table of functions, one module per stage, or a single well-organized file can all be coherent. A short script needs
no folders at all. What matters is that there is one shape and a reader can predict it.

- **Similar things are built the same way.** Having read a few, you can predict the next, and adding one is obvious.
  Every Redis command is a `xxxCommand(client *c)` function.
- **Finding the code is easy.** From "something happened" to "the code that handles it" takes a glance.
- **The parts have jobs you can name.** SQLite's layers each have a documented job. When a program is a pipeline, its
  stages are visible, as a compiler goes from lexer to parser to tree to runtime.
- **Plumbing stays out of the story.** Code about what the app does reads as the domain, not as machinery.
- **Few files, short files, names over comments.** Guard clauses first, then the work, top to bottom. Every file has to
  earn its place.

## Design patterns

Patterns are for recognizing a shape the code already needs, not for adding one. When a problem matches a known
pattern, use its standard form and its standard name, so a reader knows it on sight. Never add a pattern for a single
use. A few that often fit: Command when many operations share one way of running, Template Method when one step varies,
Adapter at the edge of an outside service, Pipeline for stages, Visitor for walking a tree.
