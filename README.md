# coherence

AI coding agents write code that works and doesn't look good: too many files, helpers written next to ones that already exist, a simple task overbuilt, and no idea holding it together. Subagents make it worse, because each one starts cold and sees one slice.

coherence is a Claude Code plugin that makes agent-written code read as if one person wrote it. One mind sets the shape first, and everything after builds on it.

Early, version 0.1. It's small, and the limits are listed below.

## What it looks like

A **brief** is the prompt the main agent hands a coding subagent. The **spine** is the committed base shapes and one running example that new code must build on.

Ask `coherence:coder` to "add a retry helper" with no spine, and a hook stops it before it writes anything:

```
Brief refused by coherence: the Idea field is missing or empty; the Spine field is missing or empty;
the Slot field is missing or empty; the Reuse field is missing or empty; the Done field is missing or empty.
Write and commit the spine first (the base shapes and a worked example the new code must build on),
then brief again with all five fields, each starting a line...
```

A brief that gets through says what the new code is building on:

```
Idea: every outbound call goes through one client, and retries live there and nowhere else.
Spine: src/lib/client.ts, src/lib/weather-client.ts
Slot: src/lib/calendar-client.ts
Reuse: the backoff in src/lib/client.ts
Done: the calendar client's tests pass and it adds no new retry code
```

Before merging, `/coherence:review main` gives a verdict: merge, fix first or rework, and why. Tell it a finding is wrong and it records that for next time.

## How it works

The main agent states the idea and commits the spine. Subagents then fill slots in dependency order. A review comes last.

| Moment | When | What happens |
|---|---|---|
| Gate | Before a subagent codes | A hook refuses a `coherence:coder` brief that doesn't name its Idea, Spine, Slot, Reuse and Done. The coder then reads the spine and your taste first, and builds on what exists. |
| Rules | After code is written | `coherence check` catches what needs no judgment. |
| Judgment | Before merging | `/coherence:review <base>` runs the rules, then the readability reviewer. A hook refuses `gh pr create` unless HEAD is the commit that had this review. |
| Learning | Whenever you correct a design | The `coherence:taste` skill records your preference in one line, so later code and reviews follow it. |

### The rule checks

These catch what needs no judgment, so a reviewer doesn't have to:

- **cycles:** import cycles, type-only ones included.
- **duplicates:** copy-pasted blocks of code.
- **flat-folder:** more than 15 source files directly in one folder.
- **architecture-doc:** no `ARCHITECTURE.md`.

Everything else is left to the reviewer's judgment: is there one idea, are similar things built the same way, were wheels reinvented, and is the solution bigger than the problem.

### Taste

Taste is text the coder and the reviewer read before they work. Nothing is trained.

- `taste/style.md` is the default opinion the plugin ships with. "The owner" in it means you.
- `~/.config/coherence/taste-log.md` is your running log, one dated line per preference. Say "drop that" to undo the newest line.
- At 40 lines the skill condenses the log into `taste-rules.md`, merging repeats and letting newer entries win. The originals move to `taste-archive.md`.

## Install

Needs Node 26 or newer, because the TypeScript runs directly with no build step. The checks fetch pinned versions of madge and jscpd through `npx`, so the plugin has no install step of its own.

```sh
claude plugin marketplace add grreardon/coherence
claude plugin install coherence@coherence
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
coherence gate                            the hook on coder spawns
coherence pr-gate [pass]                  the hook on gh pr create; pass records a review
coherence taste                           print your taste
coherence taste add "..."                 record a preference
coherence taste undo                      take back the newest one
coherence taste condense                  replace the rules with stdin and archive the log
```

## What it can't do

- The gate proves a spine was named, not that it's any good. It only covers `coherence:coder`, so your `CLAUDE.md` has to send coding work there.
- The PR hook only sees PRs Claude opens with `gh pr create`. It ties the review to the commit at HEAD, so later commits need a new review, and Claude can mark a trivial change as passed.
- The taste skill fires on Claude's judgment, so it can miss a correction or record something it shouldn't. It tells you each time it records one.
- The evals measure the reviewer and the taste skill, on tiny samples. They don't show whether the coder's output is better. See `evals/baseline.md`.
- The reviewer reads text from the repo under review, so a hostile repo could try to steer it. It has no edit tools, but it does have Bash, so be careful reviewing code from strangers.

## How well it works

These are the latest eval results, 3 runs per case on tiny sample repos. The full history is in `evals/baseline.md`.

| What was tested | Result |
|---|---|
| Finds planted defects: reinvented helpers, overbuilt code, inconsistent shapes | 21 of 21 |
| Says clean code is clean | 3 of 3, but 1 or 2 of 3 in earlier runs |
| Leaves the good parts alone | 4 of 6 |
| Records a new preference when you correct a design | 3 of 3 |
| Stays quiet on a one-off change | 3 of 3 |
| Follows a recorded preference | 2 of 3 |

## Develop

`npm install`, then `npm run check` runs types, tests, and `coherence check` on this repo. [ARCHITECTURE.md](ARCHITECTURE.md) walks a request through the modules.

Evals spend real money, about $6 for all the cases at 3 runs each:

```sh
claude plugin eval . --scaffold --runs 3 --trust-plugin --ablation none --no-publish --allow-tools Bash --judge-model sonnet
```

## License

MIT
