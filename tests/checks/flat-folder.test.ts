import assert from "node:assert/strict";
import { test } from "node:test";
import { FlatFolderCheck } from "../../src/checks/flat-folder.ts";
import { type Files } from "../helpers/sandbox.ts";
import { tempRepo } from "../helpers/temp-repo.ts";

function filesIn(folder: string, count: number): Files {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`${folder}/f${i}.ts`, "x\n"]));
}

test("flags a folder directly holding more than 15 source files", async () => {
  const repo = await tempRepo(filesIn("src", 16));
  const findings = await new FlatFolderCheck().run(repo);
  assert.deepEqual(findings.map((finding) => finding.path), ["src"]);
});

test("passes 15 files, and counts only files directly inside", async () => {
  const repo = await tempRepo({ ...filesIn("src", 15), ...filesIn("src/deep", 15) });
  assert.deepEqual(await new FlatFolderCheck().run(repo), []);
});
