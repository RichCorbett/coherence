import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { fakeInvocation, git, tempRepo, writeFiles } from "../helpers/temp-repo.ts";

const LONG = "x\n".repeat(400);

test("exits 1 and names the finding when the repo breaks a rule", async () => {
  const repo = await tempRepo({ "long.ts": LONG });
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new CheckCommand().execute(invocation), 1);
  assert.match(invocation.printed[0], /^long\.ts \[file-size\]/);
});

test("with --base, reports only files the branch changed", async () => {
  const repo = await tempRepo({ "old-long.ts": LONG, "ARCHITECTURE.md": "# Architecture\n" });
  git(repo.root, "checkout", "-q", "-b", "work");
  writeFiles(repo.root, { "new-short.ts": "x\n" });
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "change");
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), 0);
});

test("with --base, still reports a missing ARCHITECTURE.md and a folder the branch added to", async () => {
  const crowded = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`src/f${i}.ts`, "x\n"]));
  const repo = await tempRepo(crowded);
  git(repo.root, "checkout", "-q", "-b", "work");
  writeFiles(repo.root, { "src/one-more.ts": "x\n" });
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "change");
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), 1);
  assert.ok(invocation.printed.some((line) => line.startsWith("ARCHITECTURE.md [architecture-doc]")));
  assert.ok(invocation.printed.some((line) => line.startsWith("src [flat-folder]")));
});
