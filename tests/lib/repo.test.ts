import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GIT_TIMEOUT_MS, git } from "../../src/lib/repo.ts";
import { tempFolder } from "../helpers/sandbox.ts";

test("a hung git is cut off, so the PR hook refuses instead of running into its 30-second timeout", async () => {
  const bin = tempFolder();
  writeFileSync(join(bin, "git"), "#!/bin/sh\nexec /bin/sleep 10\n");
  chmodSync(join(bin, "git"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = bin;
  const started = Date.now();
  try {
    await assert.rejects(git(["status"], tempFolder(), 200), /git -c did not finish within 0.2s/);
  } finally {
    process.env.PATH = path;
  }
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

test("the default git limit leaves the hook time to answer inside its 30 seconds", () => {
  assert.ok(GIT_TIMEOUT_MS > 0 && GIT_TIMEOUT_MS <= 20_000, String(GIT_TIMEOUT_MS));
});
