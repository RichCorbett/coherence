# Owner state lives outside the repo

The agent under review can edit anything in the repo, so a baseline, rule set or trust list kept there could be edited by the very agent it judges. We keep owner state under `~/.config/coherence/`, keyed by repo, the way taste already lives outside the plugin. The cost is that a team cannot share it through git; only condensed taste (#62), whose purpose is sharing, is a candidate for living in the repo.

## Considered Options

- In the repo under `.coherence/`, read from the base branch and guarded by #66: rejected because the whole defence would rest on one guard being right.
