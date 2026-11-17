import assert from "node:assert/strict";
import { test } from "node:test";
import { FirstImportCheck } from "../../src/checks/first-import.ts";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import type { Repo } from "../../src/lib/repo.ts";
import { writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

const LAYERED = {
  "src/commands/run.ts": 'import { helper } from "../lib/helper.ts";\nexport const run = helper;\n',
  "src/commands/other.ts": "export const other = 1;\n",
  "src/lib/helper.ts": "export const helper = 1;\n",
  "src/lib/more.ts": "export const more = 2;\n",
};

async function branch(files: Record<string, string>): Promise<Repo> {
  const repo = await tempRepo(LAYERED);
  git(repo.root, "checkout", "-q", "-b", "work");
  writeFiles(repo.root, files);
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "change");
  return repo;
}

test("a branch whose lib file first imports from commands gets a note on that file", async () => {
  const repo = await branch({ "src/lib/more.ts": 'import { other } from "../commands/other.ts";\nexport const more = other;\n' });
  const findings = await new FirstImportCheck().run(repo, "main");
  assert.deepEqual(
    findings.map((finding) => [finding.path, finding.tier, finding.message]),
    [["src/lib/more.ts", "note", "first import from src/lib/ into src/commands/ (src/commands/other.ts); check the layers should depend this way"]],
  );
});

test("a second import along a direction that already exists is not a first", async () => {
  const repo = await branch({ "src/commands/other.ts": 'import { more } from "../lib/more.ts";\nexport const other = more;\n' });
  assert.deepEqual(await new FirstImportCheck().run(repo, "main"), []);
});

test("imports out of a folder the branch added are not firsts", async () => {
  const repo = await branch({ "src/feature/use.ts": 'import { helper } from "../lib/helper.ts";\nexport const use = helper;\n' });
  assert.deepEqual(await new FirstImportCheck().run(repo, "main"), []);
});

test("with no base there is nothing to compare, so nothing is reported", async () => {
  const repo = await branch({ "src/lib/more.ts": 'import { other } from "../commands/other.ts";\nexport const more = other;\n' });
  assert.deepEqual(await new FirstImportCheck().run(repo), []);
});

test("through check --base, the first import is a note and the branch stays clean", async () => {
  const repo = await branch({ "src/lib/more.ts": 'import { other } from "../commands/other.ts";\nexport const more = other;\n' });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), Exit.ok);
  assert.ok(invocation.printed.some((line) => line.startsWith("src/lib/more.ts [first-import] note: first import from src/lib/")));
  // The other note is dead-code's: nothing imports more.ts, and the branch changed it.
  assert.equal(invocation.printed.at(-1), "coherence check: clean (2 note(s))");
});

test("a folder the branch point marks export-ignore counts as new, and the check still runs", async () => {
  const repo = await tempRepo({ ...LAYERED, ".gitattributes": "src/tools/ export-ignore\n", "src/tools/gen.ts": 'import { helper } from "../lib/helper.ts";\nexport const gen = helper;\n' });
  git(repo.root, "checkout", "-q", "-b", "work");
  writeFiles(repo.root, { "src/tools/gen.ts": 'import { other } from "../commands/other.ts";\nexport const gen = other;\n' });
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "change");
  assert.deepEqual(await new FirstImportCheck().run(repo, "main"), []);
});
