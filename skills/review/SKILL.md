---
name: review
description: Coherence review of a branch or repo - runs the deterministic checks, then the readability-reviewer subagent. Use before merging non-trivial code, and over a whole repo after a big build-out.
---

# Coherence review

The argument is the base ref to compare against. With no argument, review the whole repository and leave out `--base` below.

1. **Rules first.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence check --base <ref>`. Each finding is must-fix: a reviewer should not spend attention on what a rule can catch.
2. **The reader.** Spawn the `coherence:readability-reviewer` subagent with the base ref.
3. **Report** the verdict in a sentence, ending with one call and the reason: merge, fix first or rework. Then give must-fix findings with place and concrete fix. When reviewing a branch, run `${CLAUDE_PLUGIN_ROOT}/bin/coherence pr-gate pass` afterwards, so it can open a pull request.
4. **Learn.** When the owner accepts or rejects a finding, use the `coherence:taste` skill to record it. This is how the reader learns their taste.
