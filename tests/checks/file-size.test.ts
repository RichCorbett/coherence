import assert from "node:assert/strict";
import { test } from "node:test";
import { FileSizeCheck } from "../../src/checks/file-size.ts";
import { tempRepo } from "../helpers/temp-repo.ts";

test("flags a source file over the limit and ignores a short one", async () => {
  const repo = await tempRepo({ "src/a/long.ts": "x\n".repeat(400), "src/a/short.ts": "x\n" });
  const findings = await new FileSizeCheck().run(repo);
  assert.deepEqual(findings.map((finding) => finding.path), ["src/a/long.ts"]);
});

test("does not hold fixtures to the limit", async () => {
  const repo = await tempRepo({ "src/a/fixtures/long.ts": "x\n".repeat(400) });
  assert.deepEqual(await new FileSizeCheck().run(repo), []);
});
