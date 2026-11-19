# Work-order loop: hooks that keep agents working

Agents stopped at every merge, push and eval because each one waited for an exact approval sentence typed back as a new message, and nothing re-fed the next item when a turn ended. These three hooks replace per-step approval with one approved work order. Nothing here is live until it is installed and registered; this folder ships with the plugin but `hooks/hooks.json` does not load it.

## The three hooks

| Hook | Event | What it does | When it stays out of the way |
| --- | --- | --- | --- |
| `hooks/stop-route-questions.ts` | Stop | A working turn that ends by asking Rich ("should I...?", "send this line: ...") is sent back once: decide it yourself, or file it with `dcider-ask` and keep working. | The turn used no tools, already ran `dcider-ask`, was already sent back once, or asks nothing. |
| `hooks/stop-work-order.ts` | Stop | While the approved work order has open items, the stop is blocked and the next item is handed over with the steps it may take. | No approved, unexpired work order for this folder; every item closed or parked; gh cannot answer; `stopsWithoutProgress` stops in a row with no change in the workdir; `blocksPerSession` reached. |
| `hooks/pretooluse-work-order.ts` | PreToolUse | Allows a Bash line when every command in it is a step the current item lists (merge a matching branch into the base, push the base to Rich's fork, close this item's issue, an eval within its caps) or a read or test command. Denies any edit or Bash line that names the loop home or the approve script. | Anything else prints nothing, so the usual permission flow and every other hook decide. A deny from any hook (coherence's PR gate included) or a settings.json deny rule still wins. |

Plugin installs, `~/.claude/settings.json`, force pushes, tags, releases and anything aimed at grreardon/coherence are never allowed by these hooks. They stay with the usual gates and DCider.

## The work order

`~/.config/coherence-loop/work-order.json`, in the shape of `work-order.example.json`:

- `id`, `repo`, `workdir`, `base`, `expires`: which repo and folder it covers, until when.
- `items`, in order: `issue`, `branch` pattern (`*` matches letters, digits, dot, dash, underscore), `ops` from `merge_main`, `push_main`, `close_issue`, `eval`, optional `after` (issues that must be closed first), and for `eval` the caps `evalRunsPerCall` and `evalCalls`.
- `limits`: `stopsWithoutProgress` (default 3) and `blocksPerSession` (default 30).

An item is done when its GitHub issue is closed. An item the agent cannot finish is parked by a JSON line `{"issue": N, "why": "..."}` in `<workdir>/.git/work-order-parked.jsonl`, and the loop moves on; the parked list is what Rich reads afterwards.

The work order counts only once Rich approves it: `node ~/.config/coherence-loop/bin/loop/approve.ts` prints what it allows and records its SHA-256. Any edit voids the approval, and the hooks go quiet until he approves again.

## Install (not done yet: talk it through first)

1. `loop/install.sh` copies the hooks to `~/.config/coherence-loop/bin`, outside the repo, so the agent runs a copy it cannot edit.
2. Edit `~/.config/coherence-loop/work-order.json`, then run the approve script above in your own terminal.
3. Add the entries in `settings.example.json` to the settings file you choose.

## Limits worth knowing

- The guard matches text. An agent with a shell can still reach the loop home by building the path at run time; the real line is that only Rich's own terminal changes it, and the approval hash catches an edited work order.
- The eval cap counts runs and calls, not dollars: a hook cannot see what a run costs.
- The question hook reads the transcript, whose format Claude Code does not document. It prefers `last_assistant_message` when sent, and anything unreadable counts as a working turn, which at worst sends the agent back once.
- Progress means a change to the workdir's branches or uncommitted files. Work done in a separate copy of the repo does not count until it lands there.

## Tests

`npm run test:loop` runs them against a temporary repo and a fake `gh`.
