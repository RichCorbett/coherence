import assert from "node:assert/strict";
import { chmodSync, readFileSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { SecondOpinionCommand } from "../../src/commands/second-opinion.ts";
import { setEnv, tempFolder } from "../helpers/env.ts";
import { fakeInvocation, tempRepo, writeFiles } from "../helpers/temp-repo.ts";

/** A plugin folder, an empty config home, and a PATH holding git and, if given, a stub codex. */
function isolated(t: TestContext, codexScript?: string) {
  const plugin = tempFolder();
  writeFiles(plugin, {
    "agents/readability-reviewer.md": "---\nname: readability-reviewer\n---\nREVIEWER BODY\n",
    "taste/style.md": "STYLE\n",
  });
  const bin = tempFolder();
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
  const record = join(tempFolder(), "args");
  if (codexScript) {
    writeFiles(bin, { codex: `#!/bin/sh\nprintf '%s\\n' "$@" > "${record}"\n${codexScript}\n` });
    chmodSync(join(bin, "codex"), 0o755);
  }
  setEnv(t, { CLAUDE_PLUGIN_ROOT: plugin, XDG_CONFIG_HOME: tempFolder(), PATH: bin });
  return record;
}

const WRITES_ANSWER = 'while [ $# -gt 0 ]; do [ "$1" = --output-last-message ] && echo "CANNED REVIEW" > "$2"; shift; done';

test("sends the reviewer body, taste and scope to codex read-only, and prints its last message", async (t) => {
  const record = isolated(t, WRITES_ANSWER);
  const repo = await tempRepo({ "a.ts": "x\n" });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);

  assert.equal(await new SecondOpinionCommand().execute(invocation), 0);
  assert.deepEqual(invocation.printed, ["CANNED REVIEW"]);

  const recorded = readFileSync(record, "utf8");
  assert.match(recorded, /^exec\n--sandbox\nread-only\n--ephemeral\n--cd\n/);
  assert.match(recorded, /REVIEWER BODY\n\nSTYLE\n\nReview the diff against main\n$/);
  assert.doesNotMatch(recorded, /name: readability-reviewer/);
});

test("reviews the whole repository when no base is given", async (t) => {
  const record = isolated(t, WRITES_ANSWER);
  const repo = await tempRepo({ "a.ts": "x\n" });
  await new SecondOpinionCommand().execute(fakeInvocation(repo.root));
  assert.match(readFileSync(record, "utf8"), /Review the whole repository\n$/);
});

test("prints codex's stderr and exits 1 when codex fails", async (t) => {
  isolated(t, "echo 'boom' >&2; exit 4");
  const repo = await tempRepo({ "a.ts": "x\n" });
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new SecondOpinionCommand().execute(invocation), 1);
  assert.deepEqual(invocation.printed, ["boom"]);
});

test("says it was skipped and exits 3 when codex is not installed", async (t) => {
  isolated(t);
  const repo = await tempRepo({ "a.ts": "x\n" });
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new SecondOpinionCommand().execute(invocation), 3);
  assert.match(invocation.printed[0], /skipped/);
});
