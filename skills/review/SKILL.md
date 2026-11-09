---
name: review
description: Coherence review of a branch or repo - runs the deterministic checks, then readability-reviewer and a Codex second opinion on the same rubric, and merges them. Use before merging non-trivial code, and over a whole repo after a big build-out.
---

# Coherence review

The argument is the base ref to compare against. With no argument, review the whole repository and leave out `--base` below.

1. **Rules first.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence check --base <ref>`. Each finding is must-fix: a reviewer should not spend attention on what a rule can catch.
2. **Two independent readers, at the same time.** Spawn the `coherence:readability-reviewer` subagent with the base ref. Alongside it, run `${CLAUDE_PLUGIN_ROOT}/bin/coherence second-opinion --base <ref>` in the background. Exit 3 means Codex is not installed: say so and continue with one reader.
3. **Merge.** Their mistakes differ, so agreement is the signal:
   - Both raise the same problem: must-fix.
   - Only one raises it: read the code yourself and either promote it to must-fix or drop it with a one-line reason.
4. **Report** the verdict in a sentence, then must-fix findings with place and concrete fix, then what you dropped and why.
5. **Learn.** When the owner accepts or rejects a finding, record it with `${CLAUDE_PLUGIN_ROOT}/bin/coherence taste accepted "<finding>"` or `rejected`. This is how both readers learn their taste.
