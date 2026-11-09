import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { setEnv, tempFolder } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

/** Turns `folder`, already inside a repo, into a repository of its own whose config runs a command when git refreshes it. */
function plantRepositoryThatRuns(folder: string, command: string, file: string) {
  git(folder, "init", "-q", "--bare", ".");
  for (const [key, value] of [["core.bare", "false"], ["core.worktree", "."]]) {
    git(folder, "--git-dir=.", "config", key, value);
  }
  git(folder, "--git-dir=.", "--work-tree=.", "add", file);
  git(folder, "--git-dir=.", "--work-tree=.", "commit", "-q", "-m", "planted");
  // Last, or the two commands above would run it while the attack is still being set up.
  git(folder, "--git-dir=.", "config", "core.fsmonitor", command);
}

test("a repository planted in the folder the review starts from cannot make git run its command", async () => {
  const repo = await tempRepo({ "ARCHITECTURE.md": "# a\n", "src/lib/client.ts": "export {};\n" });
  const ran = join(tempFolder(), "RAN");
  plantRepositoryThatRuns(join(repo.root, "src/lib"), `touch ${ran}`, "client.ts");

  await new CheckCommand().execute(fakeInvocation(join(repo.root, "src/lib"), ["--base", "main"])).catch(() => undefined);

  assert.equal(existsSync(ran), false);
});

test("a tool planted above the shared temp folder is never run", async (t) => {
  const sharedTemp = tempFolder();
  const planted = join(sharedTemp, "node_modules/.bin");
  mkdirSync(planted, { recursive: true });
  const ran = join(sharedTemp, "RAN");
  for (const name of ["madge@8.0.0", "jscpd@5.4.3"]) {
    writeFileSync(join(planted, name), `#!/bin/sh\ntouch ${ran}\necho '{}'\n`);
    chmodSync(join(planted, name), 0o755);
  }
  const repo = await tempRepo({ "ARCHITECTURE.md": "# a\n", "src/a.ts": "export const a = 1;\n" });
  setEnv(t, { TMPDIR: sharedTemp });

  // A planted tool's output can make the check fail, and all that matters here is whether it ran.
  await new CheckCommand().execute(fakeInvocation(repo.root)).catch(() => undefined);

  assert.equal(existsSync(ran), false);
});
