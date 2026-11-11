# The hook's `*gh pr create*` filter misses equivalent commands

**Severity:** HIGH. **Where:** `hooks/hooks.json:9`. **Found by:** all three passes (measured for the filter text; inferred for how Claude Code matches `if`).

## What happens

The PreToolUse hook only starts `coherence pr-gate` when the Bash command matches `Bash(*gh pr create*)`. The shell tokenizer in `src/lib/shell-commands.ts` was written to catch wrapped and flagged forms, but any command without that literal substring never reaches it:

- `gh -R owner/repo pr create`, which `pr-gate.test.ts:57` lists as caught
- `gh  pr create`, with two spaces
- `gh "pr" create`
- `gh pr \` followed by a newline and `create`

The parser tests pass, but in production these forms never get as far as the parser.

## Expected

Remove the `if` filter. `pr-gate` already returns at once for commands that are not PR creations. Add a test that runs the hook definition, not just the parser.

Out of scope here, and noted in [07-other-findings.md](07-other-findings.md): `gh api -X POST .../pulls`, a gh alias, a script file, or a GitHub MCP tool bypass any Bash-text gate.
