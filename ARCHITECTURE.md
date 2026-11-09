# Architecture

## The idea

Agent-written code loses coherence because each agent sees one slice and nobody holds the whole. This plugin puts
one idea around every agent: **the shape is set first, each piece must build on it, and what comes back is checked
for fit.** That gives three moments, each with one job:

1. **Before a subagent starts:** the gate refuses a coding brief that has no spine to build on.
2. **After code is written, by rule:** checks catch what needs no judgment (cycles, duplication, oversized files).
3. **After code is written, by judgment:** two reviewers from different vendors read it as a newcomer would.

An eval measures whether moment 3 actually finds what it should.

## What it is made of

There are two kinds of thing, and each has a folder, one file each, and one shape:

- `src/commands/*.ts` extends `BaseCommand`: one thing the `coherence` CLI can do.
- `src/checks/*.ts` extends `BaseCheck`: one deterministic rule.

Everything else is machinery in `src/lib/`. `Repo` is the only view of the code that checks get.

Layers go one way, enforced by `tests/architecture.test.ts`: `main.ts` -> `commands/` -> `checks/` -> `lib/`.

## One review, end to end

`coherence check --base main` starts in `src/main.ts`, which finds `CheckCommand` by name. The command opens a `Repo`,
runs every entry in its `CHECKS` list, keeps findings in files the branch changed, prints them, and exits 1 if any remain.
