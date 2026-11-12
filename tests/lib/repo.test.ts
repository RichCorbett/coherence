import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFiles } from "../helpers/sandbox.ts";
import { git, tempRepo } from "../helpers/temp-repo.ts";

test("sourceFiles sees a new file before git add, and still honors .gitignore", async () => {
  const repo = await tempRepo({ "src/a.ts": "a\n", ".gitignore": "out/\n" });
  writeFiles(repo.root, { "src/new.ts": "n\n", "out/built.js": "b\n", "src/notes.md": "m\n" });
  assert.equal(git(repo.root, "ls-files", "src/new.ts"), "");
  assert.deepEqual((await repo.sourceFiles()).sort(), ["src/a.ts", "src/new.ts"]);
});
