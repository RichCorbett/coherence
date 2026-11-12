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

test("records a preference as a dated entry, then prints it under its heading after the style", async (t) => {
  const log = isolated(t);
  assert.equal(await new TasteCommand().execute(fakeInvocation(process.cwd(), ["add", "helper", "is", "fine"])), 0);
  assert.match(readFileSync(log, "utf8"), /^- \d{4}-\d{2}-\d{2} helper is fine\n$/);

  const invocation = fakeInvocation(process.cwd());
  await new TasteCommand().execute(invocation);
  assert.match(invocation.printed[0], /^one voice\n\n## Entries not yet condensed\n\n- \d{4}-\d{2}-\d{2} helper is fine$/);
});

test("undo takes back only the newest entry, and says so when there is nothing left", async (t) => {
  const log = isolated(t);
  const command = new TasteCommand();
  await command.execute(fakeInvocation(process.cwd(), ["add", "first"]));
  await command.execute(fakeInvocation(process.cwd(), ["add", "second"]));

  const undone = fakeInvocation(process.cwd(), ["undo"]);
  assert.equal(await command.execute(undone), Exit.ok);
  assert.match(undone.printed[0], /^removed: .* second$/);
  assert.match(readFileSync(log, "utf8"), /^- \S+ first\n$/);

  await command.execute(fakeInvocation(process.cwd(), ["undo"]));
  const empty = fakeInvocation(process.cwd(), ["undo"]);
  await command.execute(empty);
  assert.deepEqual(empty.printed, ["nothing to undo"]);
});

test("recording says when the log is full and needs condensing", async (t) => {
  isolated(t);
  const command = new TasteCommand();
  for (let i = 0; i < 39; i++) await command.execute(fakeInvocation(process.cwd(), ["add", `entry ${i}`]));

  const full = fakeInvocation(process.cwd(), ["add", "the fortieth"]);
  await command.execute(full);
  assert.equal(full.printed[0], "recorded; 40 waiting to be condensed");
  assert.match(full.printed[1], /condense it now/);
});

test("condense replaces the rules, archives the entries, and the rules read before new entries", async (t) => {
  const log = isolated(t);
  const folder = dirname(log);
  const command = new TasteCommand();
  await command.execute(fakeInvocation(process.cwd(), ["add", "absorbed"]));

  const condensed = fakeInvocation(process.cwd(), ["condense"], "- plain functions first\n");
  assert.equal(await command.execute(condensed), Exit.ok);
  assert.equal(existsSync(log), false);
  assert.equal(readFileSync(join(folder, "taste-rules.md"), "utf8"), "- plain functions first\n");
  assert.match(readFileSync(join(folder, "taste-archive.md"), "utf8"), / absorbed\n$/);

  await command.execute(fakeInvocation(process.cwd(), ["add", "newer"]));
  const shown = fakeInvocation(process.cwd());
  await command.execute(shown);
  assert.match(shown.printed[0], /^one voice\n\n## Rules condensed so far\n\n- plain functions first\n\n## Entries not yet condensed\n\n- \S+ newer$/);
});

test("uncondense puts back the earlier rules and entries, keeps newer ones, and leaves the archive without duplicates", async (t) => {
  const log = isolated(t);
  const folder = dirname(log);
  const command = new TasteCommand();
  await command.execute(fakeInvocation(process.cwd(), ["add", "first"]));
  await command.execute(fakeInvocation(process.cwd(), ["condense"], "- rules one\n"));
  await command.execute(fakeInvocation(process.cwd(), ["add", "second"]));
  const archivedOnce = readFileSync(join(folder, "taste-archive.md"), "utf8");
  await command.execute(fakeInvocation(process.cwd(), ["condense"], "- rules two\n"));

  const undone = fakeInvocation(process.cwd(), ["uncondense"]);
  assert.equal(await command.execute(undone), Exit.ok);
  assert.match(undone.printed[0], /^restored the earlier rules and 1 entries$/);
  assert.equal(readFileSync(join(folder, "taste-rules.md"), "utf8"), "- rules one\n");
  assert.match(readFileSync(log, "utf8"), /^- \S+ second\n$/);
  assert.equal(readFileSync(join(folder, "taste-archive.md"), "utf8"), archivedOnce);

  const again = fakeInvocation(process.cwd(), ["uncondense"]);
  await command.execute(again);
  assert.deepEqual(again.printed, ["nothing to uncondense"]);
});

test("uncondense of the first condense removes the rules it made, and keeps entries added since", async (t) => {
  const log = isolated(t);
  const command = new TasteCommand();
  await command.execute(fakeInvocation(process.cwd(), ["add", "old"]));
  await command.execute(fakeInvocation(process.cwd(), ["condense"], "- rules\n"));
  await command.execute(fakeInvocation(process.cwd(), ["add", "new"]));
  await command.execute(fakeInvocation(process.cwd(), ["uncondense"]));

  assert.equal(existsSync(join(dirname(log), "taste-rules.md")), false);
  assert.match(readFileSync(log, "utf8"), /^- \S+ old\n- \S+ new\n$/);
});

test("an unknown verb, an empty preference, or empty rules prints the usage and exits 2", async (t) => {
  isolated(t);
  for (const args of [["maybe", "x"], ["add"], ["condense"]]) {
    const invocation = fakeInvocation(process.cwd(), args);
    assert.equal(await new TasteCommand().execute(invocation), Exit.usage);
    assert.match(invocation.errors[0], /^usage: coherence taste/);
  }
});
