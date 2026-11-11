import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, type TestContext } from "node:test";
import { installTools, runPinnedTool, runProcess } from "../../src/lib/process.ts";
import { setEnv, tempFolder, writeFiles } from "../helpers/sandbox.ts";

const REFUSED = /^coherence: the tool cache at .+ is incomplete or not a plain folder; delete it and run again$/;
// The child gives up after 3s by itself, so a missing stdin end fails this test instead of hanging the run.
const WAITS_FOR_STDIN = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); setTimeout(() => process.exit(3), 3000);";

test("a program that reads stdin sees it end instead of waiting forever", async () => {
  const result = await runProcess(process.execPath, ["-e", WAITS_FOR_STDIN], tmpdir());
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});

test("a program still running at its time limit is stopped and the call fails, naming it", async () => {
  // Exits by itself after 3s, so a missing limit fails this test instead of hanging the run.
  await assert.rejects(runProcess(process.execPath, ["-e", "setTimeout(() => process.exit(0), 3000);"], tmpdir(), 200), {
    message: / -e did not finish within 0\.2s$/,
  });
});

test("an install that starts while another is under way gets a complete install, and only one is kept", async (t) => {
  const cache = tempFolder();
  setEnv(t, { XDG_CACHE_HOME: cache });
  const scripts = ["madge/bin/cli.js", "jscpd/run-jscpd.js"];
  // Checked the moment each install returns, because a folder still being written is complete by the time both have.
  const complete = (tools: string) => ({ tools, complete: scripts.every((script) => existsSync(join(tools, "node_modules", script))) });

  const first = installTools().then(complete);
  // The second starts once the first has put a folder in the cache, which is when a half-written install could be mistaken for a finished one.
  while (!existsSync(join(cache, "coherence")) || readdirSync(join(cache, "coherence")).length === 0) await new Promise((done) => setTimeout(done, 2));
  const second = installTools().then(complete);
  const results = await Promise.all([first, second]);

  assert.deepEqual(results.map((result) => result.complete), [true, true]);
  assert.equal(results[0].tools, results[1].tools);
  // The loser's staging folder is gone, and only the finished folder is left.
  assert.deepEqual(readdirSync(join(cache, "coherence")), [basename(results[0].tools)]);
  for (const script of scripts) {
    const result = await runProcess(process.execPath, [join(results[0].tools, "node_modules", script), "--version"], tempFolder());
    assert.equal(result.code, 0, `${script}: ${result.stderr}`);
  }
});

test("installing runs no install script, not even the manifest's own", async (t) => {
  setEnv(t, { XDG_CACHE_HOME: tempFolder() });
  const manifest = tempFolder();
  const ran = join(tempFolder(), "RAN");
  const pkg = { name: "scripted", version: "1.0.0", scripts: { preinstall: `node -e "require('fs').writeFileSync(process.argv[1], '')" ${JSON.stringify(ran)}` } };
  writeFiles(manifest, {
    "package.json": JSON.stringify(pkg),
    "package-lock.json": JSON.stringify({ name: "scripted", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "scripted", version: "1.0.0" } } }),
  });

  // This manifest installs no tools, so it ends as an incomplete install, which shows npm ci itself succeeded.
  await assert.rejects(installTools(manifest), { message: REFUSED });
  assert.equal(existsSync(ran), false);
});

test("a tools folder that lacks an entry script, or is a symlink, is refused and left as it is", async (t) => {
  setEnv(t, { XDG_CACHE_HOME: tempFolder() });
  const tools = await installTools();

  rmSync(join(tools, "node_modules/jscpd/run-jscpd.js"));
  await assert.rejects(installTools(), { message: REFUSED });
  assert.equal(existsSync(join(tools, "node_modules/jscpd/run-jscpd.js")), false);
  assert.ok(existsSync(join(tools, "node_modules/madge/bin/cli.js")));

  // A symlink to a folder holding both scripts, so only the symlink check can refuse it.
  const elsewhere = tempFolder();
  writeFiles(elsewhere, { "node_modules/madge/bin/cli.js": "", "node_modules/jscpd/run-jscpd.js": "" });
  rmSync(tools, { recursive: true });
  symlinkSync(elsewhere, tools);
  await assert.rejects(installTools(), { message: REFUSED });
  assert.ok(lstatSync(tools).isSymbolicLink());
  assert.ok(existsSync(join(elsewhere, "node_modules/madge/bin/cli.js")));
});

test("an install whose npm fails uses the install another run finished meanwhile", async (t) => {
  setEnv(t, { XDG_CACHE_HOME: tempFolder() });
  // Plays the other run: puts a finished install where this run's staging folder would be renamed to, then fails.
  stubNpm(t, `final="\${PWD%-installing-*}"\nmkdir -p "$final/node_modules/madge/bin" "$final/node_modules/jscpd"\ntouch "$final/node_modules/madge/bin/cli.js" "$final/node_modules/jscpd/run-jscpd.js"\nexit 1\n`);

  const tools = await installTools();

  assert.ok(existsSync(join(tools, "node_modules/madge/bin/cli.js")));
});

test("a failed install is tried again on the next use in the same process", async (t) => {
  setEnv(t, { XDG_CACHE_HOME: tempFolder() });
  const restore = stubNpm(t, "echo stub npm failed >&2\nexit 1\n");

  await assert.rejects(runPinnedTool("madge/bin/cli.js", ["--version"]), { message: /stub npm failed/ });
  restore();
  assert.equal((await runPinnedTool("madge/bin/cli.js", ["--version"])).code, 0);
});

/** Puts an `npm` running `body` first on PATH for one test. Returns a function that takes it off early. */
function stubNpm(t: TestContext, body: string): () => void {
  const stub = tempFolder();
  writeFiles(stub, { npm: `#!/bin/sh\n${body}` });
  chmodSync(join(stub, "npm"), 0o755);
  const path = process.env.PATH ?? "";
  process.env.PATH = `${stub}:${path}`;
  const restore = () => {
    process.env.PATH = path;
  };
  t.after(restore);
  return restore;
}
