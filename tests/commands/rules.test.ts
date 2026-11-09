import assert from "node:assert/strict";
import { test } from "node:test";
import { RulesCommand } from "../../src/commands/rules.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { isolatedPlugin } from "../helpers/sandbox.ts";
import { fakeInvocation } from "../helpers/temp-repo.ts";

test("prints the plugin's design rules", async (t) => {
  isolatedPlugin(t, { "rules/design.md": "# Rules\n\n- one voice\n" });
  const invocation = fakeInvocation(process.cwd());
  assert.equal(await new RulesCommand().execute(invocation), Exit.ok);
  assert.deepEqual(invocation.printed, ["# Rules\n\n- one voice"]);
});
