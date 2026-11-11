import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { PrGateCommand } from "../../src/commands/pr-gate.ts";
import { setEnv, tempFolder } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

/**
 * Turns `folder`, already inside a repo, into a bare-looking repository of its own whose config runs `command` from a clean filter.
 * Returns the commit it holds.
 */
function plantBareRepositoryThatRuns(folder: string, command: string, file: string): string {
  git(folder, "init", "-q", "--bare", "-b", "main", ".");
  for (const [key, value] of [["core.bare", "false"], ["core.worktree", "."]]) {
    git(folder, "--git-dir=.", "config", key, value);
  }
  git(folder, "--git-dir=.", "--work-tree=.", "add", file);
  git(folder, "--git-dir=.", "--work-tree=.", "commit", "-q", "-m", "planted");
  // A clean filter, not core.fsmonitor, so that core.fsmonitor=false cannot stop it and only safe.bareRepository does.
  // Set last, or the two commands above would run it while the attack is still being set up.
  writeFileSync(join(folder, "info/attributes"), `${file} filter=planted\n`);
  git(folder, "--git-dir=.", "config", "filter.planted.clean", `${command}; cat`);
  // A newer mtime makes `git status` read the file through the filter.
  utimesSync(join(folder, file), new Date(), new Date(Date.now() + 60_000));
  return git(folder, "--git-dir=.", "rev-parse", "HEAD");
}

/** Turns `folder`, already inside a repo, into an ordinary nested repository whose core.fsmonitor runs `command`. Returns the commit it holds. */
function plantNestedRepositoryThatRuns(folder: string, command: string, file: string): string {
  // A .git folder, which safe.bareRepository does not refuse, so only core.fsmonitor=false stops it.
  git(folder, "init", "-q", "-b", "main");
  git(folder, "add", file);
  git(folder, "commit", "-q", "-m", "planted");
  // Last, or the two commands above would run it while the attack is still being set up.
  git(folder, "config", "core.fsmonitor", command);
  return git(folder, "--git-dir=.git", "rev-parse", "HEAD");
}

// Through `pr-gate pass`, which runs both the checks and `git status`, so each plant meets a git command that would run it.
for (const [kind, plant] of [["bare", plantBareRepositoryThatRuns], ["nested", plantNestedRepositoryThatRuns]] as const) {
  test(`a ${kind} repository planted in the folder the review starts from cannot make git run its command`, async () => {
    const repo = await tempRepo({ "src/lib/client.ts": "export {};\n" });
    const ran = join(tempFolder(), "RAN");
    const folder = join(repo.root, "src/lib");
    const head = plant(folder, `touch ${ran}`, "client.ts");

    const invocation = fakeInvocation(folder, ["pass", "--branch", "main", "--verdict", "merge", "--head", head]);
    await new PrGateCommand(new CheckCommand()).execute(invocation).catch(() => undefined);

    assert.equal(existsSync(ran), false);
  });
}

test("a tool planted above the shared temp folder is never run", async (t) => {
  const sharedTemp = tempFolder();
  const planted = join(sharedTemp, "node_modules/.bin");
  mkdirSync(planted, { recursive: true });
  const ran = join(sharedTemp, "RAN");
  // Named for the exact argument coherence passes: npx puts every ancestor's node_modules/.bin on PATH and runs `madge@8.0.0` from there.
  for (const name of ["madge@8.0.0", "jscpd@5.4.3"]) {
    writeFileSync(join(planted, name), `#!/bin/sh\ntouch ${ran}\necho '{}'\n`);
    chmodSync(join(planted, name), 0o755);
  }
  const repo = await tempRepo({ "src/a.ts": "export const a = 1;\n" });
  setEnv(t, { TMPDIR: sharedTemp });

  // A planted tool's output can make the check fail, and all that matters here is whether it ran.
  await new CheckCommand().execute(fakeInvocation(repo.root)).catch(() => undefined);

  assert.equal(existsSync(ran), false);
});
