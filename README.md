# coherence

AI coding agents write code that works and doesn't look good: too many files, helpers written next to ones that already exist, a simple task overbuilt, and no idea holding it together. Subagents make it worse, because each one starts cold and sees one slice.

coherence is a Claude Code plugin that makes agent-written code read as if one person wrote it. One mind sets the shape first, and everything after builds on it.

## How it works

The main agent states the idea and commits the spine: the base shapes and one complete, running example. Subagents then fill slots in dependency order. A review comes last.

| Moment | When | What happens |
|---|---|---|
| Gate | Before a subagent codes | A hook refuses a `coherence:coder` brief that doesn't name its Idea, Spine, Slot, Reuse and Done. The coder then reads the spine and your taste first, and builds on what exists. |
| Rules | After code is written | `coherence check` catches what needs no judgment. |
| Judgment | Before merging | `/coherence:review <base>` runs the rules, then two independent reviewers (Claude and Codex) on the same rubric. Problems both raise are must-fix. Problems only one raises get checked by reading the code. |
| Learning | Whenever you correct a design | The `coherence:taste` skill records your preference in one line, so later code and reviews follow it. |

### The rule checks

These catch what needs no judgment, so a reviewer doesn't have to:

- **cycles:** import cycles, type-only ones included.
- **duplicates:** copy-pasted blocks of code.
- **flat-folder:** more than 15 source files directly in one folder.
- **architecture-doc:** no `ARCHITECTURE.md`.

Everything else is left to the reviewer's judgment: is there one idea, are similar things built the same way, were wheels reinvented, and is the solution bigger than the problem.

### Taste

Taste is text the coder and both reviewers read before they work. Nothing is trained.

- `taste/style.md` holds the standing preferences and ships with the plugin.
- `~/.config/coherence/taste-log.md` is your running log, one dated line per preference. Say "drop that" to undo the newest line.
- At 40 lines the skill condenses the log into `taste-rules.md`, merging repeats and letting newer entries win. The originals move to `taste-archive.md`.

## Install

Needs Node 26 or newer, because the TypeScript runs directly with no build step. The checks fetch pinned versions of madge and jscpd through `npx`, so the plugin has no install step of its own. [Codex](https://github.com/openai/codex) is optional: without it the review runs with one reader.

```sh
claude plugin marketplace add grreardon/coherence
claude plugin install coherence@coherence-local
```

Then add something like this to your `CLAUDE.md`, because it's what makes the agent use the plugin:

```markdown
Send all coding work to `coherence:coder`. Before spawning one, state the idea in ARCHITECTURE.md and commit the spine
yourself. Before merging any non-trivial change, run `/coherence:review <base>` and fix what it finds that is real.
Whenever I reject or correct a design choice, use the `coherence:taste` skill to record it.
```

## Commands

`bin/coherence` is what the hook and skills call:

```
coherence check [--base <ref>]            run the rule checks
coherence gate                            the PreToolUse hook
coherence second-opinion [--base <ref>]   ask Codex, using the reviewer's prompt
coherence taste                           print your taste
coherence taste add "..."                 record a preference
coherence taste undo                      take back the newest one
coherence taste condense                  replace the rules with stdin and archive the log
```

## What it can't do

- The gate proves a spine was named, not that it's any good. It only covers `coherence:coder`, so your `CLAUDE.md` has to send coding work there.
- The taste skill fires on Claude's judgment, so it can miss a correction or record something it shouldn't. It tells you each time it records one.
- The evals only measure the reviewer, on tiny samples. They don't show whether the coder's output is better. See `evals/baseline.md`.
- The reviewers read text from the repo under review, so a hostile repo could try to steer them. Codex is read-only and the Claude reviewer has no edit tools, but it does have Bash, so be careful reviewing code from strangers.
- The reviewer can use gbrain's code graph tools. Without them it greps the imports instead.

## Develop

`npm run check` runs types, tests, and `coherence check` on this repo. [ARCHITECTURE.md](ARCHITECTURE.md) walks a request through the modules.

Evals, which spend real money (about $4 for the reviewer cases at 3 runs each):

```sh
claude plugin eval . --scaffold --runs 3 --trust-plugin --ablation none --no-publish --allow-tools Bash --judge-model sonnet
```
