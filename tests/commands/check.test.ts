import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

const LONG = "x\n".repeat(400);

async function commitBranchChange(root: string, files: Record<string, string>): Promise<void> {
  git(root, "checkout", "-q", "-b", "work");
  writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
}

test("exits with findings and names the finding when the repo breaks a rule", async () => {
  const repo = await tempRepo({ "src/a/long.ts": LONG });
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.match(invocation.printed[0], /^src\/a\/long\.ts \[file-size\]/);
});

test("with --base, reports only files the branch changed", async () => {
  const repo = await tempRepo({ "src/a/old-long.ts": LONG, "ARCHITECTURE.md": "# Architecture\n" });
  await commitBranchChange(repo.root, { "src/a/new-short.ts": "x\n" });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), Exit.ok);
});

test("with --base, a file of the same name in another folder is not the changed file", async () => {
  const repo = await tempRepo({ "src/a/long.ts": LONG, "ARCHITECTURE.md": "# Architecture\n" });
  await commitBranchChange(repo.root, { "src/b/long.ts": "x\n" });
  assert.equal(await new CheckCommand().execute(fakeInvocation(repo.root, ["--base", "main"])), Exit.ok);
});

test("with --base, a branch that edits only one file of a cycle still answers for it", async () => {
  const repo = await tempRepo({
    "src/x/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
    "src/x/b.ts": "export const b = 1;\n",
    "ARCHITECTURE.md": "# Architecture\n",
  });
  await commitBranchChange(repo.root, { "src/x/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n' });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.ok(invocation.printed.some((line) => line.startsWith("src/x/b.ts [cycles]")));
});

test("with --base, still reports a missing ARCHITECTURE.md and a folder the branch added to", async () => {
  const crowded = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`src/f${i}.ts`, "x\n"]));
  const repo = await tempRepo(crowded);
  await commitBranchChange(repo.root, { "src/one-more.ts": "x\n" });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.ok(invocation.printed.some((line) => line.startsWith("ARCHITECTURE.md [architecture-doc]")));
  assert.ok(invocation.printed.some((line) => line.startsWith("src [flat-folder]")));
});
