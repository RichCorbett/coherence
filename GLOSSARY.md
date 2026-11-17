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

### Ownership

**Owner**:
The person whose taste and rules coherence enforces; the only one who may change owner state.
_Avoid_: user, maintainer

**Owner state**:
What only the owner may change: the baseline, the rules and the trusted repos. It lives where the agent under review cannot write.
_Avoid_: config, settings

### Review

**Gate**:
The refusal to open a pull request until the branch's current commit has a review whose call was merge.
_Avoid_: hook, check, PR guard

**Guard**:
The refusal of an agent's edit to the gate or to owner state.
_Avoid_: lock, protection

**Rule**:
A written design principle the reviewer holds code to, taken from the design rules or the owner's taste.
_Avoid_: guideline, principle, policy

**Unsupported finding**:
A reviewer finding whose quoted rule does not appear word for word in any rule.
_Avoid_: hallucinated finding

### Taste

**Taste**:
The owner's recorded design preferences: the shipped style, the condensed taste and the taste log.
_Avoid_: preferences, style guide

**Baseline**:
The findings the owner accepted as they stood on one day, which later checks leave out.
_Avoid_: allowlist, suppressions, ignore list

**Brief**:
What the agent reads before it writes in a folder: the rules, the owner's taste, and the names already exported nearby.
_Avoid_: context, primer
