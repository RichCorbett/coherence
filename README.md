# coherence

AI coding agents write code that works and doesn't look good: too many files, helpers written next to ones that already exist, a simple task overbuilt, and no idea holding it together.

coherence is a Claude Code plugin that checks whether agent-written code reads as if one person wrote it. It does not write code. It runs deterministic checks, has one reader judge the rest, remembers your design preferences, prints the design rules, and gates pull requests on a review.

Early, version 0.1. It's small, and the limits are listed below.

## What it looks like

Before merging, `/coherence:review main` runs the rule checks, then a reader that follows one real flow through the code the way a new engineer would. It gives a verdict: merge, fix first or rework, and why, with each must-fix finding placed and given a concrete fix. Tell it a finding is wrong and it records that for next time.

Opening a pull request before that review, or after more commits have landed on top of it, is refused:

```
PR refused by coherence: commits landed on branch feature after its coherence review. Run /coherence:review <base>, fix what is real, then open the PR again. ...
```

## How it works

| Moment | When | What happens |
|---|---|---|
| Rules | After code is written | `coherence check` catches what needs no judgment. |
| Judgment | Before merging | `/coherence:review <base>` runs the rules, then the readability reviewer, which runs on Sonnet and holds the code to `coherence rules` and your taste. A hook refuses `gh pr create` unless HEAD is the commit that had this review. |
| Learning | Whenever you correct a design | The `coherence:taste` skill records your preference in one line, so later reviews follow it. |

The design rules live in `rules/design.md`. `coherence rules` prints them, so whatever writes the code can read the standard the reviewer applies.

### The rule checks

These catch what needs no judgment, so a reviewer doesn't have to:

- **cycles:** import cycles, type-only ones included. Imports through `paths` aliases are followed when the repo has a plain (not symlinked) `tsconfig.json` at its root; only its `baseUrl` and the `paths` aliases whose targets all stay inside the repo, symlinks resolved, are used, so `extends`, outside targets, comments in the file and a nested package's own tsconfig are not.
- **duplicates:** copy-pasted blocks of code.
- **flat-folder:** more than 15 source files directly in one folder.

Everything else is left to the reviewer's judgment: is there one idea, are similar things built the same way, were wheels reinvented, and is the solution bigger than the problem.

### Taste

Taste is text the reviewer, and anything that writes code, reads before working. Nothing is trained.

- `taste/style.md` is the default opinion the plugin ships with. "The owner" in it means you.
- `~/.config/coherence/taste-log.md` is your running log, one dated line per preference. Say "drop that" to undo the newest line.
- At 40 lines the skill condenses the log into `taste-rules.md`, merging repeats and letting newer entries win. The originals move to `taste-archive.md`. Each condense first copies the old rules to `taste-rules.<UTC timestamp>.md` in the same folder; to undo one, copy that file over `taste-rules.md`.

## Install

Needs git, and a Node that runs TypeScript directly, because there is no build step. What decides is a runtime check, not the version: before every command `bin/coherence` asks node for `process.features.typescript`, giving it 5 seconds. Only Node 22.22.3 and 26.13.0 have been tested; other versions are untested, and older 22.x releases and 23.x below 23.6 are reported to need a flag. If node cannot run, every command prints one `coherence:` line saying why, and exits 4; a git that cannot run fails at the first git call instead. The plugin has no install step of its own: on first use the checks install madge and jscpd, and every package they depend on, from the plugin's lockfile in `tools/` with `npm ci --ignore-scripts`, into `~/.cache/coherence` (or `$XDG_CACHE_HOME/coherence`). That needs `npm` and the npm registry once; later runs reuse the install until the lockfile changes.

```sh
claude plugin marketplace add grreardon/coherence
claude plugin install coherence@coherence
```

Then add something like this to your `CLAUDE.md`, because it's what makes the agent use the plugin:

```markdown
Before merging any non-trivial change, run `/coherence:review <base>` and fix what it finds that is real.
Before writing code, read `coherence rules` and `coherence taste`.
Whenever I reject or correct a design choice, use the `coherence:taste` skill to record it.
```

## Commands

`bin/coherence` is what the hook and skills call:

```
coherence check [--base <ref>]            run the rule checks
coherence pr-gate                         the hook on gh pr create
coherence pr-gate pass --verdict <call> --branch <name> --head <id> [--base <id>]
                                          revoke the branch's review, then record a merge review of
                                          HEAD; refuses any other call, another branch checked out,
                                          a HEAD that moved, a base equal to HEAD, uncommitted
                                          changes, untracked files or check findings
coherence review-input [--base <ref>]     print what the reviewer's prompt needs: taste, rules and the diff
coherence rules                           print the design rules
coherence taste                           print your taste
coherence taste add "..."                 record a preference
coherence taste undo                      take back the newest one
coherence taste condense                  replace the rules with stdin and archive the log
```

## What it can't do

- The PR hook stops an agent from publishing unreviewed work through the ordinary `gh pr create` command. It is not a boundary against an agent that deliberately hides the command, through expansions, `eval`, functions defined earlier or `gh api`, a gh alias (`gh alias set pc 'pr create'`, then `gh pc`), a pipe into `xargs gh`, the name in other capitals (`GH`, which macOS finds as `gh`), or an exported `GH_REPO` from an earlier Bash call, which the hook's own environment never sees (a `gh repo set-default` is stored in git config, so the hook does read it, and refuses any default other than origin's `base`); hard enforcement belongs to GitHub branch protection with a required check. It judges only a Bash line that is exactly `gh pr create` with fixed words, and refuses any other line that mentions it, even in a commit message. It also refuses any other line whose quoted text or heredoc body holds `gh` as a word, in any case, because shell syntax is too varied to be sure where such text ends and a hidden command could sit in it; the one `--body "$(cat <<'EOF' ... EOF)"` form of a PR line is read exactly, so its body may mention gh. It ties the review to the commit at HEAD, so later commits need a new review, and to the base it was reviewed against: the PR must name, with `--base`, a local branch at that base, so a PR to another base needs a new review. A review of the whole repo, with no base, lets the PR name any base, and an approval that records no base at all, such as one left by an earlier version, needs a new review. The base is compared in the local clone, not on GitHub, so a stale local branch or a remote that moves can still give the PR a diff the review did not read: fetch before opening the PR, and rely on branch protection for hard enforcement. `pr-gate pass` records only a merge verdict on a clean tree with clean checks. It re-reads HEAD and the tree after the checks, but a file edited and put back while they run is not caught. The record is a git config value (`branch.<name>.coherence-reviewed`), and the hook refuses any Bash line that names that key, so `git config` cannot write it. That is advisory: the Edit or Write tools on `.git/config`, a key hidden from the text, or an agent running the review skill's own `pr-gate pass` line without having reviewed anything can still forge it. Owners who need enforcement should use GitHub branch protection with a required status check. If node is missing or cannot run TypeScript, or git does not run, or either takes more than 5 seconds to answer, the hook cannot read its input, so it refuses any Bash line in which `gh` appears as a word, in any case, and lets the rest run (if `grep` is missing or fails too, it refuses every line). It cannot fail closed when `bin/coherence` itself does not start, or when it passes its 30-second timeout: then Claude Code lets the command run.
- The taste skill fires on Claude's judgment, so it can miss a correction or record something it shouldn't. It tells you each time it records one.
- The taste file is one global file for all your repos, written on Claude's judgment, and the reviewer treats it as its standard. Text from a hostile repo that gets recorded there changes every later review, in every repo. Read what it records.
- The evals measure the reviewer and the taste skill, on tiny samples. They were last run with the reviewer on Sonnet. See `evals/baseline.md`. Every planted-case grader checks that a defect was found or a good shape kept, none fails a report for extra findings, and Sonnet is both reviewer and judge, so the numbers are recall on small cases, not precision. The fixture docs used to state the shape that `stated-the-idea` and `kept-the-good-shape` look for; they no longer do, and the numbers below were measured before that change.
- The reviewer reads text from the repo under review, so a hostile repo could try to steer it. It has no edit tools and no Bash: the review skill runs `coherence review-input` in your session, which prints the taste, the rules and the diff, and hands it the text. It can still Read files anywhere on disk if a repo misleads it, because Claude Code agent files cannot restrict paths. Review code from strangers in an isolated checkout or a sandbox.

## How well it works

These numbers predate two changes: the reviewer losing Bash, and the rule to drop findings a preference says not to flag (see `evals/baseline.md`). They have not been measured on the current pipeline.

These results are from the reviewer on Sonnet, at 3 runs per case on tiny sample repos. The full history is in `evals/baseline.md`.

| What was tested | Result |
|---|---|
| Finds planted defects: reinvented helpers, overbuilt code, inconsistent shapes | 21 of 21 |
| Says clean code is clean | 3 of 3, but 1 or 2 of 3 in earlier runs |
| Leaves the good parts alone | 4 of 6 |
| Records a new preference when you correct a design | 3 of 3 |
| Stays quiet on a one-off change | 3 of 3 |
| Follows a recorded preference | 3 of 3 |

## Develop

`npm install`, then `npm run check` runs types, tests, and `coherence check` on this repo. [ARCHITECTURE.md](ARCHITECTURE.md) walks a request through the modules.

Evals spend real money, about $6 for all the cases at 3 runs each:

```sh
claude plugin eval . --scaffold --runs 3 --trust-plugin --ablation none --no-publish --allow-tools Bash --judge-model sonnet
```

The eval's sandbox blocks the home folder, except `~/.local/bin`, and Apple's developer tools, so it needs:

- **Node and git reachable from outside the home folder**, for example from Homebrew in `/opt/homebrew/bin`. A `~/.local/bin/node` that links back into the home folder is not enough, and neither is Apple's `/usr/bin/git`, which hands off to the blocked CommandLineTools.
- **No `coherence` on PATH.** Under `plugin eval` the plugin's `bin/` is not on the agent's PATH, so each reviewer case's scaffold writes `.coherence-bin/coherence`, which starts this copy of the plugin, and the prompt runs that. It is left out of the case's git repo, so nothing reviews it.

Each reviewer case has a `ran-review-input` grader. When it fails, the first step failed and the case's other scores mean no review ran, not a bad one.

## License

MIT
