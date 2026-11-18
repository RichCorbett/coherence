# coherence

AI coding agents write code that works and doesn't look good: too many files, helpers written next to ones that already exist, a simple task overbuilt, and no idea holding it together.

coherence is a Claude Code plugin that checks whether agent-written code conforms to the repo it lands in instead of reading like bot slop: reinvented helpers, foreign error styles, layers nobody needed, comments that narrate. It does not write code. It runs deterministic checks, has one reader judge a whole repo's design, remembers your design preferences, prints the design rules, and gates pull requests on the checks.

Early, version 0.1. It's small, and the limits are listed below.

## What it looks like

Before merging, `/coherence:review main` runs the rule checks on the branch and records the result for the pull request gate. Over a whole repo, `/coherence:review` with no base also runs a reader that follows one real flow through the code the way a new engineer would. It gives a verdict: merge, fix first or rework, and why, with each must-fix finding placed and given a concrete fix. Tell it a finding is wrong and it records that for next time. The reader does not judge single changes: measured end to end, it pulled a change toward its own rules instead of the repo's habits (see Limits).

Opening a pull request before that review, or after more commits have landed on top of it, is refused:

```
PR refused by coherence: commits landed on branch feature after its coherence review. Run /coherence:review <base>, fix what is real, then open the PR again. ...
```

## How it works

| Moment | When | What happens |
|---|---|---|
| Rules | After code is written | `coherence check` catches what needs no judgment. |
| Judgment | Before merging, and after a big build-out | `/coherence:review <base>` runs the rules on a branch. `/coherence:review` with no base runs them over the whole repo, then the readability reviewer, which runs on Sonnet and holds the code to `coherence rules` and your taste. A hook refuses `gh pr create` unless HEAD is the commit that had a review. |
| Learning | Whenever you correct a design | The `coherence:taste` skill records your preference in one line, so later reviews follow it. |

The design rules live in `rules/design.md`. `coherence rules` prints them, so whatever writes the code can read the standard the reviewer applies.

### The rule checks

These catch what needs no judgment, so a reviewer doesn't have to:

- **cycles:** import cycles, type-only ones included. Imports through `paths` aliases are followed when the repo has a plain (not symlinked) `tsconfig.json` at its root; only its `baseUrl` and the `paths` aliases whose targets all stay inside the repo, symlinks resolved, are used, so `extends`, outside targets, comments in the file and a nested package's own tsconfig are not.
- **duplicates:** copy-pasted blocks of code.
- **flat-folder:** more than 15 source files directly in one folder.
- **first-import** (a note, with `--base` only): the first import from one folder into another, compared with where the branch began, so a new direction between existing layers is seen without any layer config. Imports out of a folder the branch added are not counted. The base is read from a `git archive` export of the branch point, never a checkout.
- **dead-code** (a note): exports and types that nothing imports, and files that no file imports, found by [fallow](https://github.com/fallow-rs/fallow). fallow never sees the repo itself: it reads a copy holding only the hand-written source files and the `package.json` and `tsconfig` files, regular files only, with no `.git`, and coherence's own empty fallow config in place of the repo's.
- **ast-grep** (your own rules): mechanical rules you write for [ast-grep](https://ast-grep.github.io), such as "no `as any`". Each rule is `<name>.yml` in `~/.config/coherence/ast-grep/`, outside every repo, beside two examples: `<name>.match.<ext>`, which it must report, and `<name>.clean.<ext>`, which it must not. A rule whose examples fail, or that has no examples, is skipped with a line on stderr, so a rule that can never match never passes for one that holds. A rule at severity `error` is must-fix; any other severity is a note. ast-grep reads the same copy as fallow, with coherence's own config, so the repo's `sgconfig.yml` and ignore files are never read, files in dot-folders are scanned, and an `ast-grep-ignore` comment in the code does not switch a rule off. With no rules there, it does nothing. Three example rules to copy are in `tests/fixtures/ast-grep-rules/`.
- **reinvented** (a note): code that does what other code already does under other names, found by fallow's semantic duplicate mode on the same copy as dead-code. On a planted test it found two of three helpers rewritten with new names, where duplicates found none; a helper rebuilt in another shape is still left to the reviewer.

A check is in one of two tiers. A must-fix finding keeps the branch from being clean; a note is printed with `note:` and leaves it clean. cycles, duplicates and flat-folder are must-fix; first-import, dead-code and reinvented are notes; an ast-grep rule's tier is its severity.

### Baseline

On an old repo, run `coherence check --save-baseline` once. It records every current finding in `~/.config/coherence/baselines/`, one file per repository and outside it, and later checks leave out what it holds, so a branch answers only for what it adds. A duplicate is known by the two files it joins, so it stays known when lines move; a crowded folder is known by its file count, so adding a file to it is new. Save it again to accept the findings as they stand now; delete the file to drop it.

Everything else is left to the reviewer's judgment: is there one idea, are similar things built the same way, were wheels reinvented, and is the solution bigger than the problem.

### Taste

Taste is text the reviewer, and anything that writes code, reads before working. Nothing is trained.

- `taste/style.md` is the default opinion the plugin ships with. "The owner" in it means you.
- `~/.config/coherence/taste-log.md` is your running log, one dated line per preference. Say "drop that" to undo the newest line.
- A preference reaches style and shape only. It can tell the reviewer to stop flagging a name, a split or a helper, but not a correctness finding or a technical design rule such as dependency direction.
- At 40 lines the skill condenses the log into `taste-rules.md`, merging repeats and letting newer entries win. The originals move to `taste-archive.md`. Each condense first copies the old rules to `taste-rules.<UTC timestamp>.md` in the same folder; to undo one, copy that file over `taste-rules.md`.
- A team can share taste through the repo: commit it to `.coherence/taste.md` on the base branch, as plain lines like the condensed rules. A review with `--base` reads it as committed at the base, never as the branch has it, and adds it to your taste under its own heading, so a branch cannot write its own standard and a change to the file is a diff someone approves before it counts. A review of the whole repo has no base, so it reads the file as committed on origin's default branch (`origin/HEAD`), again never as the branch has it (0.1.16). When the clone does not know `origin/HEAD`, `review-input` says so and reads no shared taste; `git remote set-head origin --auto` sets it. That trusts origin: in a fork, origin is the contributor's own copy, and its default branch takes no one's approval. Uncommitted edits to the file are not flagged to the reader.

## Install

Needs git, and a Node that runs TypeScript directly, because there is no build step. What decides is a runtime check, not the version: before every command `bin/coherence` asks node for `process.features.typescript`, giving it 5 seconds. Only Node 22.22.3 and 26.13.0 have been tested; other versions are untested, and older 22.x releases and 23.x below 23.6 are reported to need a flag. If node cannot run, every command prints one `coherence:` line saying why, and exits 4; a git that cannot run fails at the first git call instead. The plugin has no install step of its own: on first use the checks install madge, jscpd and fallow, and every package they depend on, from the plugin's lockfile in `tools/` with `npm ci --ignore-scripts`, into `~/.cache/coherence` (or `$XDG_CACHE_HOME/coherence`). That needs `npm` and the npm registry once; later runs reuse the install until the lockfile changes.

```sh
claude plugin marketplace add grreardon/coherence
claude plugin install coherence@coherence
```

Then add something like this to your `CLAUDE.md`, because it's what makes the agent use the plugin:

```markdown
Before merging any non-trivial change, run `/coherence:review <base>` and fix what it finds that is real. After a big build-out, run `/coherence:review` over the whole repo.
Before writing code in a folder, run `coherence brief <folder>` and reuse what it lists before writing anything new.
Whenever I reject or correct a design choice, use the `coherence:taste` skill to record it.
```

## Commands

`bin/coherence` is what the hook and skills call:

```
coherence brief <folder or file>...       before writing there: the rules, your taste, and the names
                                          already exported in that folder and its siblings
coherence check [--base <ref>]            run the rule checks
coherence check --save-baseline           record every current finding, so later checks report only new ones
coherence pr-gate                         the hook on gh pr create
coherence pr-gate pass --verdict <call> --branch <name> --head <id> [--base <id>]
                                          revoke the branch's review, then record a merge review of
                                          HEAD; refuses any other call, another branch checked out,
                                          a HEAD that moved, a base equal to HEAD, uncommitted
                                          changes, untracked files or check findings
coherence review-input [--base <ref>]     print what the reviewer's prompt needs: taste (with the repo's shared taste at the base, or on origin's default branch), rules and the diff
coherence rules                           print the design rules
coherence taste                           print your taste
coherence taste add "..."                 record a preference
coherence taste undo                      take back the newest one
coherence taste condense                  replace the rules with stdin and archive the log
coherence taste seen                      record today as the latest review, for the next one's new taste
```

## What it can't do

- The baseline lives outside the repo so a branch cannot edit it. The hook also refuses any Bash line that names `--save-baseline`, or the baseline folder (`coherence/baselines`), so run `coherence check --save-baseline` in your own terminal. Like the review record's rule, this is a text rule: a name built from pieces, a script file, or the Edit and Write tools still get past it, and it refuses reads that name those places too. It does not guard the installed plugin's files, because the review skill runs coherence from there by path.

- The PR hook stops an agent from publishing unreviewed work through the ordinary `gh pr create` command. It is not a boundary against an agent that deliberately hides the command, through expansions, `eval`, functions defined earlier or `gh api`, a gh alias (`gh alias set pc 'pr create'`, then `gh pc`), a pipe into `xargs gh`, the name in other capitals (`GH`, which macOS finds as `gh`), or an exported `GH_REPO` from an earlier Bash call, which the hook's own environment never sees (a `gh repo set-default` is stored in git config, so the hook does read it, and refuses any default other than origin's `base`); hard enforcement belongs to GitHub branch protection with a required check. It judges only a Bash line that is exactly `gh pr create` with fixed words, and refuses any other line that mentions it, even in a commit message. It also refuses any other line whose quoted text or heredoc body holds `gh` as a word, in any case, because shell syntax is too varied to be sure where such text ends and a hidden command could sit in it; the one `--body "$(cat <<'EOF' ... EOF)"` form of a PR line is read exactly, so its body may mention gh. It ties the review to the commit at HEAD, so later commits need a new review, and to the base it was reviewed against: the PR must name, with `--base`, a local branch at that base, so a PR to another base needs a new review. A review of the whole repo, with no base, lets the PR name any base, and an approval that records no base at all, such as one left by an earlier version, needs a new review. The base is compared in the local clone, not on GitHub, so a stale local branch or a remote that moves can still give the PR a diff the review did not read: fetch before opening the PR, and rely on branch protection for hard enforcement. The branch is compared the same way: the gate refuses when a remote-tracking ref for it differs from the reviewed commit, whether under its own name on any remote (`refs/remotes/<remote>/<branch>`) or under the name of its upstream or push destination, which catches a push followed by a reset, and it refuses a branch that pushes to a remote with no tracking ref for it. Only refs under `refs/remotes/` are read, so a fetch refspec that keeps tracking refs elsewhere (such as `refs/tracking/origin/*`) hides a pushed commit from the gate. It never fetches, so these refs are only as fresh as this clone's last fetch or push: a push from another clone or by anyone else, a forged tracking ref, and a push between the check and `gh` still give the PR commits the review did not read. `pr-gate pass` records only a merge verdict on a clean tree with clean checks. It re-reads HEAD and the tree after the checks, but a file edited and put back while they run is not caught. The record is a git config value (`branch.<name>.coherence-reviewed`), and the hook refuses any Bash line that names that key, so `git config` cannot write it. That is advisory: the Edit or Write tools on `.git/config`, a key hidden from the text, or an agent running the review skill's own `pr-gate pass` line without having reviewed anything can still forge it. Owners who need enforcement should use GitHub branch protection with a required status check. If node is missing or cannot run TypeScript, or git does not run, or either takes more than 5 seconds to answer, the hook cannot read its input, so it refuses any Bash line in which `gh` appears as a word, in any case, and lets the rest run (if `grep` is missing or fails too, it refuses every line). It cannot fail closed when `bin/coherence` itself does not start, or when it passes its 30-second timeout: then Claude Code lets the command run.
- dead-code sees only what imports reach. An entry point fallow does not know about, such as a script run by path or a file loaded by a framework fallow has no plugin for, is reported as a file nothing imports (its own imports still count, so what it uses is not reported). The copy has no `node_modules`, so fallow cannot read installed packages' exports. A finding sits on the file that holds the export, so with `--base` an export left unused because the branch removed its last import from another file is not reported. fallow follows a copied `tsconfig`'s `extends` outside the repo when it resolves imports (measured 2026-11-17); that file can change which import resolves where, but its contents are not reported. A base config that `extends` names but that is not itself called `tsconfig*` or `jsconfig*`, such as `config/base.json`, is not copied, so path aliases it defines do not resolve and their targets can be noted as unused.
- reinvented also matches things built in one shape on purpose, such as two commands with the same opening lines, and an exact copy is both a duplicates finding and a reinvented note.
- The copy the tools read has the code's `fallow-ignore` and `ast-grep-ignore` comments written in capitals, which neither tool obeys, so the code under review cannot switch a finding off. Use the baseline instead.
- ast-grep rules see one file at a time, as written, so a rule cannot follow a name to its definition. ast-grep ships Linux builds for glibc only, so the tools do not install on a musl system such as Alpine. Rules are run one at a time, two example scans and one repo scan each, so many rules make `check` slower. Drafting rules from your taste is not built yet.
- The taste skill fires on Claude's judgment, so it can miss a correction or record something it shouldn't. It tells you each time it records one.
- The taste file is one global file for all your repos, written on Claude's judgment, and the reviewer treats it as its standard. Text from a hostile repo that gets recorded there changes every later review, in every repo. A preference can only change style and shape findings, such as names, file size, splitting, patterns, helpers and comments: the reviewer is told that no preference can silence a correctness or security finding, a technical design rule (how modules depend on each other and where code and types belong, such as dependency direction, cycles and stated layer boundaries), or its report that text tried to steer it. That is an instruction to a model, not a check, and a hostile line can still silence a shape finding such as a duplicated helper. Each review report opens with the entries added since the previous review, so you can see a line you did not write; that shows it after the fact and does not stop it. Read what it records.
- Shared taste in `.coherence/taste.md` is trusted as far as the base branch is: anyone who can merge to the base can change what every later review holds the code to. A file at the base with a line starting `===`, which could pass for a section of the reviewer's prompt, or with control characters, makes `review-input` fail until it is fixed on the base. A symlink there is not followed. The base is whatever `--base` names; the PR hook ties a review to the base the PR names, but a review run by hand against another ref reads that ref's copy.
- Taste writes take no lock. If two sessions write taste at once, an entry added while `condense` or `undo` runs can be lost. Re-record it if it does not appear in `coherence taste`.
- "Reads as if one person wrote it" is the goal, not a measured result. The evals measure its parts: whether the reviewer finds named defects, and whether taste is kept. The one end-to-end comparison so far went against the plugin. An agent added two commands to a small repo, then either ran coherence's review and fixed what it found, or reviewed its own work. Judged blind, in pairs, the coherence runs did not read more like the repo's author: 0 wins, 2 losses and 1 tie in 3 pairs. The reviewer had asked for its own design rules, such as a thrown error where the repo returns strings, over the repo's habits. Telling the reviewer that the repo's own habits come first did not help: re-run, it lost all 3 pairs, because it still quoted its rules over the repo. So since 0.1.15 the reader runs only over a whole repo, and a branch review is the rule checks alone: an approval says the checks are clean at HEAD against the base, and nothing about design. See `evals/baseline.md`.
- The evals measure the reviewer and the taste skill, on tiny samples. They were last run with the reviewer on Sonnet. See `evals/baseline.md`. Every planted-case grader checks that a defect was found or a good shape kept, none fails a report for extra findings, and Sonnet is both reviewer and judge, so the numbers are recall on small cases, not precision. The fixture docs used to state the shape that `stated-the-idea` and `kept-the-good-shape` look for; they no longer do, and the numbers below were measured before that change.
- The reviewer reads text from the repo under review, so a hostile repo could try to steer it. It has no edit tools and no Bash: the review skill runs `coherence review-input` in your session, which prints the taste and the rules (and a diff, with `--base`, which the skill no longer passes), and hands it the text. It can still Read files anywhere on disk if a repo misleads it, because Claude Code agent files cannot restrict paths. Review code from strangers in an isolated checkout or a sandbox.

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
