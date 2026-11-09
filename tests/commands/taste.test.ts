import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Exit } from "../../src/lib/base-command.ts";
import { TasteCommand } from "../../src/commands/taste.ts";
import { isolatedPlugin } from "../helpers/sandbox.ts";
import { fakeInvocation } from "../helpers/temp-repo.ts";

function isolated(t: TestContext) {
  return join(isolatedPlugin(t, { "taste/style.md": "one voice\n" }), "coherence", "taste-log.md");
}

test("prints the shipped style alone when there is no personal log", async (t) => {
  isolated(t);
  const invocation = fakeInvocation(process.cwd());
  assert.equal(await new TasteCommand().execute(invocation), 0);
  assert.deepEqual(invocation.printed, ["one voice"]);
});

test("records a verdict as a dated line, then prints it after the style", async (t) => {
  const log = isolated(t);
  assert.equal(await new TasteCommand().execute(fakeInvocation(process.cwd(), ["rejected", "helper", "is", "fine"])), 0);
  assert.match(readFileSync(log, "utf8"), /^- \d{4}-\d{2}-\d{2} rejected: helper is fine\n$/);

  const invocation = fakeInvocation(process.cwd());
  await new TasteCommand().execute(invocation);
  assert.match(invocation.printed[0], /^one voice\n\n- \d{4}-\d{2}-\d{2} rejected: helper is fine$/);
});

test("an unknown verb, or a verdict with no finding, prints the usage and exits 2", async (t) => {
  isolated(t);
  for (const args of [["maybe", "x"], ["accepted"]]) {
    const invocation = fakeInvocation(process.cwd(), args);
    assert.equal(await new TasteCommand().execute(invocation), Exit.usage);
    assert.match(invocation.errors[0], /^usage: coherence taste/);
  }
});
