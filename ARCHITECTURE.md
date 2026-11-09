# Architecture

## The idea

Agent-written code loses coherence because each agent sees one slice and nobody holds the whole. This plugin puts
one idea around every agent: **the shape is set first, each piece must build on it, and what comes back is checked
for fit.** That gives four moments, each with one job:

1. **Before a subagent starts:** the gate refuses a coding brief that has no spine to build on.
2. **After code is written, by rule:** checks catch what needs no judgment (cycles, duplication, flat folders, a missing architecture doc).
3. **After code is written, by judgment:** two reviewers from different vendors read it as a newcomer would.
4. **Whenever the owner corrects a design:** the taste skill records it, so the coder and both reviewers follow it next time.

| Moment | Files |
| --- | --- |
| Gate | `hooks/hooks.json`, `agents/coder.md`, `src/commands/gate.ts` |
| Rules | `src/commands/check.ts`, `src/checks/` |
| Judgment | `skills/review/SKILL.md`, `agents/readability-reviewer.md`, `src/commands/second-opinion.ts`, `src/commands/pr-gate.ts`, `taste/` |
| Learning | `skills/taste/SKILL.md`, `src/commands/taste.ts`, `src/lib/taste.ts` |

An eval measures whether moment 3 actually finds what it should. `evals/` is run by Claude Code's own
`claude plugin eval`: it is case files (fixture repos and graders) with no runner of ours.

## What it is made of

There are two kinds of thing, and each has a folder, one file each, and one shape:

- `src/commands/*.ts` extends `BaseCommand`: one thing the `coherence` CLI can do.
- `src/checks/*.ts` extends `BaseCheck`: one deterministic rule.

Everything else is machinery in `src/lib/`. Checks read code through `Repo`, and two (`cycles`, `duplicates`) also
delegate to external tools, madge and jscpd, pinned and run through npx from an empty folder, so the repo under review cannot replace them. A `Finding`'s path is always relative to the
repo root, and its scope (file, folder or repo) says when a branch is answerable for it. Every command returns one of
the named `Exit` codes; an error that escapes a command is printed as one line by `main.ts` and exits `Exit.failed`.

Layers go one way, enforced by `tests/architecture.test.ts`: `main.ts` -> `commands/` -> `checks/` -> `lib/`.

## One rule check, end to end

`coherence check --base main` starts in `src/main.ts`, which finds `CheckCommand` by name. The command opens a `Repo`
(`openReviewTarget`, shared with `second-opinion`), runs every entry in its `CHECKS` list, keeps findings the branch is
answerable for according to each finding's scope, prints them, and exits `Exit.findings` if any remain.

## One review, end to end

`skills/review/SKILL.md` drives a review of a branch. It first runs `coherence check --base <ref>`; each finding is
must-fix, so no reader spends attention on what a rule can catch. Then two readers work at the same time on the same
rubric: the `readability-reviewer` subagent, and `coherence second-opinion`, which sends the reviewer's prompt plus the
owner's taste to Codex (exit `Exit.unavailable` means Codex is not installed, and the review goes on with one reader).
The skill merges them: a problem both raise is must-fix, one raised by only one is checked by reading the code and
promoted or dropped with a reason. The skill then runs `coherence pr-gate pass`, which marks the branch in git config, and
the `pr-gate` hook refuses `gh pr create` from a branch without that mark. When the owner accepts or rejects a finding, or corrects a design in conversation, the
`taste` skill records one general line through `coherence taste`, and both readers read it next time. At 40 lines the
same skill condenses them into rules and archives the originals.

## One correction, end to end

The owner says something like "stop adding barrel files." The `taste` skill fires on its description, checks the
preference isn't already known, and runs `coherence taste add` with one general line that says what the owner wants.
`lib/taste.ts` appends it, dated, to `taste-log.md` in the owner's config folder, outside the plugin so it survives an
update. The next `coherence taste` prints the shipped style, then the condensed rules, then the log, and that is what
the coder and both reviewers read. At 40 entries the command says the log is full, and the skill writes new rules from
the old rules and the entries. `coherence taste condense` replaces `taste-rules.md` and moves the entries to
`taste-archive.md`.

## One coder spawn, end to end

When the main agent spawns a `coder` subagent, Claude Code runs the PreToolUse hook in `hooks/hooks.json`, which calls
`bin/coherence gate` (the one way into the CLI) with the hook JSON on stdin. `GateCommand` ignores every other subagent type. For a coder it reads the
five brief fields and opens a `Repo` from each spine path's own folder, because the
target repo can differ from the session's, then asks `repo.isCommitted`. Any problem comes back as one `deny` naming
all of them, telling the agent to write and commit the spine first; otherwise the gate prints nothing and the spawn
proceeds. Later, `coherence second-opinion` sends the same reviewer prompt plus the owner's taste (`lib/taste.ts`) to Codex.

The brief fields are defined once, in `FIELDS` in `src/commands/gate.ts`, and the same meanings are in the description of
`agents/coder.md`, which is the text read before spawning:

- **Idea:** how the thing works and what it is made of, in a few sentences.
- **Spine:** committed paths of the base shapes and worked example to build on, or the surrounding code for a change inside an existing shape.
- **Slot:** the one piece this agent builds.
- **Reuse:** the existing helpers and libraries to use.
- **Done:** the condition that proves it finished.
