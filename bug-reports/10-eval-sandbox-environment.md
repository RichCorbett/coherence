# The eval cannot run its first step on a machine set up differently from the author's

**Severity:** MED, eval validity. **Where:** the eval case prompts, `evals/*/case.yaml`; `README.md`'s eval section. **Found by:** running `claude plugin eval` on the no-shape case, 2026-11-11 12:15-12:46 EST, Claude Code 2.1.311 on macOS. Every point below was measured from kept traces.

## What happens

The baseline scores 3/3 per grader, but this run first scored 0, in 3 runs and then again in 3 single re-runs. The reviewer never ran: each time the agent stopped at the case's first step, `coherence review-input`. Three separate causes, cleared one at a time:

1. **The bare name `coherence` is not found.** The eval loads the plugin as `coherence@inline`, and its `bin/` folder is not on the agent's PATH. This holds even with the plugin installed and enabled. In a normal session `which coherence` does find `bin/coherence`, so this affects the eval only. This is ACE re-check 2's F4, which was wrongly marked refuted.
2. **Node is unreachable.** The eval's OS sandbox denies reading the home folder and allows back only `~/.local/bin`. On this machine `~/.local/bin/node` is a symlink into the home folder, so `node: not found`.
3. **git is unreachable.** Apple's `/usr/bin/git` hands off to `/Library/Developer/CommandLineTools`, which the sandbox refuses ("Operation not permitted"). The scaffold's own `git init` runs outside the sandbox, so the scaffold succeeds and only the agent's step fails.

After installing Node and git with Homebrew (`/opt/homebrew/bin`), one run passed 3/3. Even then, the bare name failed, and the agent found `bin/coherence` by its full path in the plugin cache. A run that does not think to search scores 0.

## Expected

- **Prompts that do not depend on PATH.** Say where the command lives in words the agent can act on, or have the scaffold link `bin/coherence` into a folder the sandbox allows. Do not use `${CLAUDE_PLUGIN_ROOT}`: it is not set in Bash, per the plugin docs (relayed).
- **State what the eval needs.** In the README: Node and git reachable from outside the home folder, for example from Homebrew; Apple's git shim is not enough.
- **A failed setup step should read as an error, not a score.** All three causes were reported as ordinary grader failures. A grader that first checks the review ran at all would make a 0 mean "no review".

## Related

- Bug report 07: "the eval answer leak" and "no precision grader" items, the same file's eval validity section.
- Issue #31, a false deny on any mention of opening a PR. Seen in real use at 16:53 EST: the gate refused a heredoc that only wrote this review's text to a file, because the text named the command.
