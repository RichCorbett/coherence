import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runProcess } from "../../src/lib/process.ts";

test("a program that reads stdin sees it end instead of waiting forever", async () => {
  const result = await runProcess("/bin/cat", [], tmpdir());
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});

test("a program that ignores the polite signal is still stopped at the time limit", async () => {
  const stubborn = runProcess("/bin/sh", ["-c", "trap '' TERM; exec /bin/sleep 30"], tmpdir(), 100);
  await assert.rejects(stubborn, /\/bin\/sh did not finish within 100ms/);
});
