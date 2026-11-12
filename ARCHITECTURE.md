# Architecture

## The idea

Agent-written code loses coherence because each agent sees one slice and nobody holds the whole. This plugin checks
what comes back for fit, and it does not write code. It gives that check three moments, each with one job:

1. **By rule:** checks catch what needs no judgment (cycles, duplication, flat folders).
2. **By judgment:** a reviewer reads the code as a newcomer would, holds it to the design rules, and a pull request is refused until the commit at HEAD has had that review.
3. **Whenever the owner corrects a design:** the taste skill records it, so the reviewer, and anything that reads `coherence taste`, follows it next time.

| Moment | Files |
| --- | --- |
| Rules | `src/commands/check.ts`, `src/checks/` |
| Judgment | `skills/review/SKILL.md`, `agents/readability-reviewer.md`, `rules/design.md`, `src/commands/rules.ts`, `src/commands/pr-gate.ts`, `hooks/hooks.json` |
| Learning | `skills/taste/SKILL.md`, `src/commands/taste.ts`, `src/lib/taste.ts`, `taste/` |

Evals measure whether moments 2 and 3 actually do what they should. `evals/` is run by Claude Code's own
`claude plugin eval`: it is case files (fixture repos and graders) with no runner of ours.

## What it is made of

There are two kinds of thing, and each has a folder, one file each, and one shape:

- `src/commands/*.ts` extends `BaseCommand`: one thing the `coherence` CLI can do.
- `src/checks/*.ts` extends `BaseCheck`: one deterministic rule.

Everything else is machinery in `src/lib/`. Checks read code through `Repo`, and two (`cycles`, `duplicates`) also
delegate to external tools, madge and jscpd, installed once from the plugin's own lockfile (`tools/`) with `npm ci --ignore-scripts` and run from an empty folder, so the repo under review cannot replace or configure them. A `Finding`'s path is always relative to the
repo root, and its scope (file or folder) says when a branch is answerable for it. Every command returns one of
the named `Exit` codes; an error that escapes a command is printed as one line by `main.ts` and exits `Exit.failed`.

Layers go one way, enforced by `tests/architecture.test.ts`: `main.ts` -> `commands/` -> `checks/` -> `lib/`.

## One rule check, end to end

`coherence check --base main` starts in `src/main.ts`, which finds `CheckCommand` by name. The command opens a `Repo`, runs every entry in its `CHECKS` list, keeps findings the branch is
answerable for according to each finding's scope, prints them, and exits `Exit.findings` if any remain.

## One review, end to end

`skills/review/SKILL.md` drives a review of a branch. It first runs `coherence check --base <ref>`; each finding is
must-fix, so the reader spends no attention on what a rule can catch. Then the skill runs `coherence review-input`, which resolves the base ref to a commit ID without a shell and prints the taste, the taste entries dated since the previous review (the day is kept in `taste-last-review` beside the log, and the skill puts them at the top of its report), the rules (`rules/design.md`
through `readPluginFile`) and the branch diff, and pastes that into the prompt of the `readability-reviewer` subagent. The subagent
runs on Sonnet with only Read, Glob and Grep, so repo text it reads cannot make it run anything, though it can still Read any file on disk (agent files cannot limit paths). It reads the code as a
newcomer would. The skill reports its verdict and findings, then runs
`coherence pr-gate pass --verdict <call> --branch <name> --head <id> --base <id>` whatever the call. `pass` first revokes the branch's
earlier approval. Only for merge does it go on: it refuses unless HEAD is still that commit and the tree is clean, runs
the `check` command again (main.ts hands it over, since commands do not import each other), checks that nothing moved
while it ran, and then stores the HEAD commit, and the base next to it, for the branch in git config. The `pr-gate` hook runs before
`gh pr create` and compares HEAD with that stored commit. If the branch has no stored commit, or HEAD has moved on, it
refuses and says whether the branch was never reviewed or commits landed after the review. When the owner accepts or
rejects a finding, or corrects a design in conversation, the `taste` skill records one general line through
`coherence taste`, and the reader reads it next time. At 40 lines the same skill condenses them into rules and archives
the originals.

## One correction, end to end

The owner says something like "stop splitting things up like this." The `taste` skill fires on its description, checks the
preference isn't already known, and runs `coherence taste add` with one general line that says what the owner wants.
`lib/taste.ts` appends it, dated, to `taste-log.md` in the owner's config folder, outside the plugin so it survives an
update. The next `coherence taste` prints the shipped style, then the condensed rules, then the log, and that is what
the reviewer reads. At 40 entries the command says the log is full, and the skill writes new rules from
the old rules and the entries. `coherence taste condense` replaces `taste-rules.md` and moves the entries to
`taste-archive.md`, after copying the old rules to a timestamped `taste-rules.<time>.md` backup.
