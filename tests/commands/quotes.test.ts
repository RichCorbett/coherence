import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { QuotesCommand } from "../../src/commands/quotes.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { isolatedPlugin, tempFolder } from "../helpers/sandbox.ts";
import { fakeInvocation } from "../helpers/temp-repo.ts";

const PLUGIN = {
  "rules/design.md": "# How code must be designed\n\n- **One voice.** Reuse what exists;\n  never write a second one beside it.\n- **Dependencies go one way** between modules.\n",
  "taste/style.md": "# Style\n\n- Prefer plain words over clever ones.\n- Don't split a file that reads well whole.\n",
};

async function quotes(t: TestContext, args: string[]) {
  isolatedPlugin(t, PLUGIN);
  const invocation = fakeInvocation(tempFolder(), args);
  return { exit: await new QuotesCommand().execute(invocation), printed: invocation.printed };
}

test("a quote copied from the rules or the taste is found, whatever its line breaks and emphasis", async (t) => {
  const { exit, printed } = await quotes(t, ['"Reuse what exists; never write a second one beside it."', "Dependencies go one way between modules", "Prefer plain words over clever ones"]);
  assert.equal(exit, Exit.ok);
  assert.deepEqual(printed.map((line) => line.split(":")[0]), ["found", "found", "found"]);
});

test("an invented or reworded rule is not found, and the command says which", async (t) => {
  const { exit, printed } = await quotes(t, ["Reuse what exists", "Every helper must live in a utils folder", "never write a second helper beside it"]);
  assert.equal(exit, Exit.findings);
  assert.deepEqual(printed, ["not found: Reuse what exists", "not found: Every helper must live in a utils folder", "not found: never write a second helper beside it"]);
});

test("a quote with the curly apostrophe the skill writes for a straight one is found", async (t) => {
  const { exit } = await quotes(t, ["Don’t split a file that reads well whole"]);
  assert.equal(exit, Exit.ok);
});

test("a quote that runs across two rules, starts inside a word or is a heading is not found", async (t) => {
  const { exit, printed } = await quotes(t, ["beside it. - Dependencies go one way", "ever write a second one beside it", "clever ones. - Don't split", "How code must be designed"]);
  assert.equal(exit, Exit.findings);
  assert.deepEqual(printed.map((line) => line.split(":")[0]), ["not found", "not found", "not found", "not found"]);
});

test("needs at least one quote", async (t) => {
  assert.equal((await quotes(t, [])).exit, Exit.usage);
});
