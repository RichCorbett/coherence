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
  const repo = await tempRepo({ "old-long.ts": LONG });
  git(repo.root, "checkout", "-q", "-b", "work");
  writeFiles(repo.root, { "new-short.ts": "x\n" });
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "change");
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), 0);
});
