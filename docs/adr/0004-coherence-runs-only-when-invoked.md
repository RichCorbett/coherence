# Coherence runs only when invoked

The owner wants coherence to cost nothing on an ordinary turn, so its work runs when a `/coherence:*` command or the agent invokes it, never on every turn or every edit. #58 therefore became a note in `coherence check` instead of an after-edit hook: the agent learns of a duplicate name at review time rather than seconds after the edit, which #57's brief makes cheap. The PR gate is the one hook, because its job is to catch a pull request opened without a review; measured on 2026-11-17 it costs about 80 ms per Bash call.

## Considered Options

- An after-edit hook for #58, on by default and warn only, with a 100 ms median ceiling: rejected because plugin hooks fire on every matching tool call in any project where coherence is enabled, and cannot be limited to the span of a skill.
