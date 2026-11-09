import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

test("undo takes back only the newest entry, and says so when there is nothing left", async (t) => {
  const log = isolated(t);
  const command = new TasteCommand();
  await command.execute(fakeInvocation(process.cwd(), ["rejected", "first"]));
  await command.execute(fakeInvocation(process.cwd(), ["accepted", "second"]));

  const undone = fakeInvocation(process.cwd(), ["undo"]);
  assert.equal(await command.execute(undone), Exit.ok);
  assert.match(undone.printed[0], /^removed: .*accepted: second$/);
  assert.match(readFileSync(log, "utf8"), /^- \S+ rejected: first\n$/);

  await command.execute(fakeInvocation(process.cwd(), ["undo"]));
  const empty = fakeInvocation(process.cwd(), ["undo"]);
  await command.execute(empty);
  assert.deepEqual(empty.printed, ["nothing to undo"]);
});

test("recording says when the log is full and needs condensing", async (t) => {
  isolated(t);
  const command = new TasteCommand();
  for (let i = 0; i < 39; i++) await command.execute(fakeInvocation(process.cwd(), ["rejected", `entry ${i}`]));

  const full = fakeInvocation(process.cwd(), ["rejected", "the fortieth"]);
  await command.execute(full);
  assert.equal(full.printed[0], "recorded; 40 waiting to be condensed");
  assert.match(full.printed[1], /condense it now/);
});

test("condense replaces the rules, archives the entries, and the rules read before new entries", async (t) => {
  const log = isolated(t);
  const folder = dirname(log);
  const command = new TasteCommand();
  await command.execute(fakeInvocation(process.cwd(), ["rejected", "absorbed"]));

  const condensed = fakeInvocation(process.cwd(), ["condense"], "- plain functions first\n");
  assert.equal(await command.execute(condensed), Exit.ok);
  assert.equal(existsSync(log), false);
  assert.equal(readFileSync(join(folder, "taste-rules.md"), "utf8"), "- plain functions first\n");
  assert.match(readFileSync(join(folder, "taste-archive.md"), "utf8"), /rejected: absorbed\n$/);

  await command.execute(fakeInvocation(process.cwd(), ["rejected", "newer"]));
  const shown = fakeInvocation(process.cwd());
  await command.execute(shown);
  assert.match(shown.printed[0], /^one voice\n\n- plain functions first\n\n- \S+ rejected: newer$/);
});

test("an unknown verb, a verdict with no finding, or empty rules prints the usage and exits 2", async (t) => {
  isolated(t);
  for (const args of [["maybe", "x"], ["accepted"], ["condense"]]) {
    const invocation = fakeInvocation(process.cwd(), args);
    assert.equal(await new TasteCommand().execute(invocation), Exit.usage);
    assert.match(invocation.errors[0], /^usage: coherence taste/);
  }
});
