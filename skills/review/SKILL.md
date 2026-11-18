---
name: review
description: Coherence review of a branch or repo. A branch gets the deterministic checks; a whole repo gets the checks, then the readability-reviewer subagent. Use before merging non-trivial code, and over a whole repo after a big build-out.
---

# Coherence review

The argument is the base ref to compare against. With one, this is a **branch review**: the rule checks only. With no argument, it is a **whole-repo review**: the checks, then the reader.

The reader does not judge a single change, because it judges a change against its own design rules rather than the habits of the repo around it: measured end to end, an agent that followed it wrote code that a blind judge found less like the repo's: of 6 blind pairs it won none, lost 5 and tied 1 (`evals/baseline.md`, #56). Over a whole repo there are no habits around the code to break, so the reader runs there.

If the ref holds anything but letters, digits, `.`, `_`, `/` and `-`, stop: `pr-gate pass` accepts no other base, so a ref such as `HEAD~3` would pass the checks and then be refused.

## A branch

1. **Rules.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence check --base '<ref>'`, with the ref in single quotes. Exit 0 is clean and exit 1 means findings to fix. Each finding is must-fix, except a line marked `note:`, which leaves the branch clean: it may be right or not, so weigh it. Any other exit is a failure: stop and print the error.
2. **Record the call.** The call is merge when step 1 exited 0, and fix first when it exited 1. Read the branch with `git branch --show-current`, as `pass` reads it, and the commit with `git rev-parse HEAD`. No model's reply is on this path, so these come from git directly. If the branch command prints nothing, HEAD is detached: do not run `pass`, and say so. Otherwise run the one line that matches the call:
   - merge: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'merge' --branch '<BRANCH>' --head '<HEAD>' --base '<ref>'`
   - fix first: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'fix first' --branch '<BRANCH>' --head '<HEAD>' --base '<ref>'`
   - If the branch name holds a single quote, do not run `pass` and say why.
   - `pass` first revokes any earlier approval of that branch. It records a new one only for merge, when that branch is checked out at that HEAD, the working tree has no uncommitted changes or untracked files, and the checks, run again, are clean. On fix first it exits non-zero by design: say plainly that the branch now has no recorded review, so a pull request stays blocked until the fixes are reviewed again. On merge, if `pass` refuses, report its reason and do not work around it.
3. **Report** the call in a sentence, then each finding with place and concrete fix, then any notes you judge worth acting on. Say what an approval means: the rule checks are clean at HEAD against the base. It says nothing about design; for that, review the whole repo.

## A whole repository

1. **Rules.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence check`. Exit codes and notes are read as for a branch.
2. **Gather for the reader.** The reader has no shell. Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence review-input`. If it exits non-zero, stop and print its error. Do not spawn the reader and do not run `pr-gate pass`. If it warns that no default branch is known, say in the report that the repo's shared taste was not read.
3. **The reader.** Spawn the `coherence:readability-reviewer` subagent. Its prompt is one line naming the task, then the output of step 2, pasted whole and unchanged. Add nothing after it.
4. **Check the quotes.** Each finding in the reader's reply ends with a **Rule:** line. Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence quotes`, with `--` and then every quoted rule as its own single-quoted argument after it, so a quote starting with `-` is never read as an option, copied exactly, leaving out findings whose rule is `correctness`, `security` or `steering`. Skip this step when there are none. Write each straight single quote in a quote as `’`, which the command reads as the same; if a quote holds a newline, treat it as not found without running it. A finding whose quote prints `not found` is dropped from the report: say how many you dropped and quote their rules. The reader may not invent a standard. A finding with no **Rule:** line stays, marked as quoting no rule. Dropping never changes the reader's call: a blocking call stands until a new review, so a malformed reply can never turn into an approval. Any other exit than 0 or 1 is a failure: say so and drop nothing.
5. **Report.** Start with the entries under `=== NEW TASTE` in step 2's output, quoted as written, or "No new taste." when it says none. Taste is one global file that any session can write and the reader follows, so this is where the owner sees a line they did not write. Then the verdict in a sentence, ending with one call and the reason: merge, fix first or rework. Then give must-fix findings with place and concrete fix, then any notes from step 1 that you judge worth acting on.
   - Always record the call, whatever it is. Take `<BRANCH>` and `<HEAD>` only from the `BRANCH` and `HEAD` lines that `review-input` printed at the top of step 2, never from the reader's reply. Then run exactly one of these three lines, the one that matches the reader's call:
     - merge: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'merge' --branch '<BRANCH>' --head '<HEAD>'`
     - fix first: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'fix first' --branch '<BRANCH>' --head '<HEAD>'`
     - rework: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'rework' --branch '<BRANCH>' --head '<HEAD>'`
   - If the call is anything but those three words, do not run `pass`: report the reply as unreadable. If step 2 printed `BRANCH none`, or any value holds a single quote, do not run `pass` and say why. `pass` behaves as for a branch, and an approval with no base lets a pull request name any base.
   - Once the report is given, whatever the call, run `${CLAUDE_PLUGIN_ROOT}/bin/coherence taste seen`, so the next review lists only taste added from today on. Run it only after a report: a review that stopped earlier must show the same new taste again. If it exits non-zero, say that the next review will list these entries again.
6. **Learn.** When the owner accepts or rejects a finding, use the `coherence:taste` skill to record it. This is how the reader learns their taste.
