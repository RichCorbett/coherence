# coherence

A Claude Code plugin that makes agent-written code read like one person wrote it, in three moments: a gate refuses a coding brief with no committed spine, rule checks catch what needs no judgment, and two reviewers from different vendors (Claude and Codex) judge the rest. See ARCHITECTURE.md.

Install: `claude plugin marketplace add <path>` then `claude plugin install coherence@coherence-local`.

Commands (`bin/coherence`): `check [--base <ref>]`, `gate` (the PreToolUse hook), `second-opinion [--base <ref>]`, `taste [accepted|rejected "<finding>"]`. The `review` skill runs them together.

Develop: `npm run check` (types, tests, and `coherence check` on this repo).

Evals: `claude plugin eval . --scaffold --runs 3 --trust-plugin --ablation none --no-publish --allow-tools Bash --judge-model sonnet`
