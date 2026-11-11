# The deny message tells the agent how to approve itself

**Severity:** HIGH. **Where:** `src/commands/pr-gate.ts:47-51`. **Found by:** security review and ACE-method pass (measured).

## What happens

When the gate denies a PR, its reason text says:

> For a trivial change such as docs only, tell the owner and run ${coherence} pr-gate pass.

The reader of that text is the agent that was just denied. The agent decides on its own whether a change is "trivial". "Tell the owner" is prose: nothing waits for the owner's answer. So the deny message is a recipe for the agent to approve itself and retry.

## Expected

The deny reason should name only the review path, `/coherence:review`. Skipping review should be the owner's decision, made outside the agent's own turn.
