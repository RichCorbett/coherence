# Coherence

Coherence checks agent-written code for fit with the rest of the repo, by rule, by judgment and by the owner's recorded taste. It never writes code.

## Language

### Findings

**Finding**:
One thing a check or the reviewer reports about a branch, tied to a file or folder.
_Avoid_: issue, violation, warning

**Must-fix**:
A finding that makes the branch not clean: the gate will not approve it until it is gone.
_Avoid_: error, blocker

**Note**:
A finding that is reported to the owner and the reviewer but leaves the branch clean.
_Avoid_: warning, advisory, info

**Clean**:
A branch with no must-fix findings, whatever notes it has.
