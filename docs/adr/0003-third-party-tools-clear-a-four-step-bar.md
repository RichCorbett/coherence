# Third-party tools clear a four-step bar

Coherence runs its analyzers on code written by an agent it does not trust, so a tool that executes repo code or obeys repo settings would hand that agent a shell. Every new tool must pass a contained source review, a hand test on a planted hostile repo, an exact pin by version and hash installed with `npm ci --ignore-scripts`, and must run from an empty folder; a tool that calls git runs on an exported copy of the branch, never the agent's working tree.

## Consequences

- The hostile-repo step is not a formality: on 2026-11-17 `fallow audit` ran a command planted in the repo's `.git/config` (core.fsmonitor), which the source review had flagged only as a possibility. On a `git archive` export it ran nothing.
