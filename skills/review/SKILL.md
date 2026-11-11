---
name: review
description: Coherence review of a branch or repo - runs the deterministic checks, then the readability-reviewer subagent. Use before merging non-trivial code, and over a whole repo after a big build-out.
---

# Coherence review

The argument is the base ref to compare against. With no argument, review the whole repository and leave out `--base` below.

1. **Rules first.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence check --base '<ref>'`, with the ref in single quotes. If the ref contains a single quote or a newline, stop. Exit 0 is clean and exit 1 means findings. Each finding is must-fix: a reviewer should not spend attention on what a rule can catch. Any other exit is a failure: stop and print the error.
2. **Gather for the reader.** The reader has no shell. Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence review-input --base '<ref>'`, again in single quotes, and leave out `--base` for a whole repository. If it exits non-zero, stop and print its error. Do not spawn the reader and do not run `pr-gate pass`.
3. **The reader.** Spawn the `coherence:readability-reviewer` subagent. Its prompt is one line naming the task, then the output of step 2, pasted whole and unchanged. Add nothing after it.
4. **Report** the verdict in a sentence, ending with one call and the reason: merge, fix first or rework. Then give must-fix findings with place and concrete fix. When reviewing a branch, run `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass` afterwards, so it can open a pull request. If that fails, report the failure.
5. **Learn.** When the owner accepts or rejects a finding, use the `coherence:taste` skill to record it. This is how the reader learns their taste.
