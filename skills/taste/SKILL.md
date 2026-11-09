---
name: taste
description: Records the owner's design preferences so future code and reviews follow them. Use whenever the owner rejects or corrects a design, structure, naming or code style choice in a way that should carry over to future work ("I don't like how this is built", "never do X", "stop splitting things up like this"), and when they accept or reject a finding from /coherence:review. Not for a one-off change to one thing ("remove it", "make this blue"), a bug report, or a question.
---

# Record the owner's taste

The agents that write and review code read this log before they work, so one wrong entry steers everything after it. Record what the owner would want applied next time, and nothing else.

1. **Check it isn't known.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence taste`. If the preference is already there, stop.
2. **Write one line that says what the owner wants.** State the general preference, close to their words, without project or file names. "Don't add a factory for something with one use", not "the notifier factory in app X was too much". When they turn down a review finding, the line says what to stop flagging: "A helper used twice is fine, don't flag it".
3. **Record it.** Run `${CLAUDE_PLUGIN_ROOT}/bin/coherence taste add "<line>"`.
4. **Say so in one short line,** and carry on with what they asked: `Added to taste: <line>. Say "drop that" to undo it.`

If they say to drop it, run `${CLAUDE_PLUGIN_ROOT}/bin/coherence taste undo`.

## When the command says the log is full

Condense it right then, in this session, and leave out the offer to undo, because condensing empties the log:

1. Read everything with `${CLAUDE_PLUGIN_ROOT}/bin/coherence taste`. Your input is the part under `## Rules condensed so far` and `## Entries not yet condensed`, and everything above those headings ships with the plugin.
2. Write short rules that cover the earlier rules and all the entries. Merge repeats. When two conflict, the newer wins. Keep the owner's words where you can, and don't add anything they didn't say.
3. Pipe the rules in, through a heredoc on stdin, to `${CLAUDE_PLUGIN_ROOT}/bin/coherence taste condense`. They replace the earlier rules, and the entries move to an archive.
4. Tell the owner in a line or two what changed, including anything you dropped because a newer entry overrode it.
