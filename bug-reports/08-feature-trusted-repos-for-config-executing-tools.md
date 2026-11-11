# Feature request: only run config-executing tools on repos the owner trusts

**Type:** feature request. **Raised by:** Rich, 2026-11-11. **Status:** proposal; nothing here is built.

## Why

Some useful checks run the code of the repo they analyse. knip loads files such as `vite.config.ts` and `jest.config.js` through its plugins, and StrykerJS runs the test suite. On the owner's own repo that is fine. On a repo from somewhere else it means running code nobody has judged safe. madge and jscpd stay safe only because coherence runs them from an empty temp folder. See `analyzer-security-review-2026-11-11.md` in the parent project.

## The trap to avoid

The obvious design has the review skill ask "is this your own code?" and switch knip on if the answer is yes. That fails. The question is answered inside the same agent session that is reading the repo, so a hostile repo can talk that session into "yes". Bug 03 has the same shape: the agent approves itself. The trust decision has to come from the owner and live outside the repo and outside the agent's reach.

## Proposal

1. **Prefer tools that need no trust.** For dead code and unused exports, evaluate fallow. It is a Rust binary and, as reported (not yet verified), runs no repo code by default; it also covers duplicates and cycles. Use knip only where fallow falls short.
2. **A trust list, off by default.** `${XDG_CONFIG_HOME:-~/.config}/coherence/trusted-repos`, one entry per line: the repo's remote URL and its absolute root.
   - Only a command the owner runs, `coherence trust add` or `coherence trust remove`, writes to it.
   - The review skill and the reviewer agent never write to it, and the skill tells the agent never to run `trust`.
   - `coherence check` runs knip, and later Stryker, only when the current repo matches an entry. Otherwise it prints that the check was skipped and why, so the skip is visible.
3. **A fence for trusted runs anyway.** Run config-executing tools under `sandbox-exec` on macOS (no network, writes only to a temp folder) or in a container. A trusted repo can still pull in a compromised dependency.
4. **A switch that cannot hide the default.** `--with-knip` and `--without-knip` flags may narrow what runs, but no flag may enable knip on an untrusted repo.

## Open questions

- Should trust be keyed on the remote URL, the root path, or both? A clone of a trusted URL into a new folder: trusted or not?
- Does knip have a supported way to skip config loading entirely, and is the result still useful? Unverified.
- Does fallow cover enough of knip's dead-code results to make knip unnecessary? Measure on a real repo before deciding.
