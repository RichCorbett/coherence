import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const HOOKS = resolve(import.meta.dirname, "../hooks/hooks.json");

test("the Bash PreToolUse hook runs pr-gate on every Bash call, with no `if` filter to miss equivalent spellings", () => {
  const { hooks } = JSON.parse(readFileSync(HOOKS, "utf8"));
  const bash = hooks.PreToolUse.filter((entry: { matcher: string }) => entry.matcher === "Bash");
  assert.equal(bash.length, 1);
  const gate = bash[0].hooks.filter((hook: { command: string }) => /\bpr-gate\b/.test(hook.command));
  assert.equal(gate.length, 1);
  assert.equal("if" in gate[0], false, "an `if` filter would hide `gh -R o/r pr create` from the parser");
});
