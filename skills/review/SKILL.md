---
name: review
description: Coherence review of a branch or repo - runs the deterministic checks, then the readability-reviewer subagent. Use before merging non-trivial code, and over a whole repo after a big build-out.
---

# Coherence review

The argument is the base ref to compare against. With no argument, review the whole repository and leave out `--base` below.

1. **Rules first.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence check --base '<ref>'`, with the ref in single quotes. If the ref contains a single quote or a newline, stop. Exit 0 is clean and exit 1 means findings. Each finding is must-fix: a reviewer should not spend attention on what a rule can catch. Any other exit is a failure: stop and print the error.
2. **Gather for the reader.** The reader has no shell. Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence review-input --base '<ref>'`, again in single quotes, and leave out `--base` for a whole repository. If it exits non-zero, stop and print its error. Do not spawn the reader and do not run `pr-gate pass`.
3. **The reader.** Spawn the `coherence:readability-reviewer` subagent. Its prompt is one line naming the task, then the output of step 2, pasted whole and unchanged. Add nothing after it.
4. **Report** the verdict in a sentence, ending with one call and the reason: merge, fix first or rework. Then give must-fix findings with place and concrete fix.
   - When reviewing a branch, always record the call, whatever it is. Take `<BRANCH>`, `<HEAD>` and `<BASE>` only from the `BRANCH`, `HEAD` and `BASE` lines that `review-input` printed at the top of step 2, never from the reader's reply. Then run exactly one of these three lines, the one that matches the reader's call:
     - merge: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'merge' --branch '<BRANCH>' --head '<HEAD>' --base '<BASE>'`
     - fix first: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'fix first' --branch '<BRANCH>' --head '<HEAD>' --base '<BASE>'`
     - rework: `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass --verdict 'rework' --branch '<BRANCH>' --head '<HEAD>' --base '<BASE>'`
   - If the call is anything but those three words, do not run `pass`: report the reply as unreadable. Leave out `--base '<BASE>'` when step 2 printed `BASE none`. If it printed `BRANCH none`, or any value holds a single quote, do not run `pass` and say why.
   - `pass` first revokes any earlier approval of that branch. It records a new one only for merge, when that branch is checked out at that HEAD, the working tree has no uncommitted changes or untracked files, and the checks are clean. On fix first or rework it exits non-zero by design: say plainly that the branch now has no recorded review, so a pull request stays blocked until the fixes are reviewed again. On merge, if `pass` refuses, report its reason and do not work around it.
5. **Learn.** When the owner accepts or rejects a finding, use the `coherence:taste` skill to record it. This is how the reader learns their taste.
