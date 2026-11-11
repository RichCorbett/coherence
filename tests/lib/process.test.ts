import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runProcess } from "../../src/lib/process.ts";

// The child gives up after 3s by itself, so a missing stdin end fails this test instead of hanging the run.
const WAITS_FOR_STDIN = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); setTimeout(() => process.exit(3), 3000);";

test("a program that reads stdin sees it end instead of waiting forever", async () => {
  const result = await runProcess(process.execPath, ["-e", WAITS_FOR_STDIN], tmpdir());
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});
