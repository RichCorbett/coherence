import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { installTools, runProcess } from "../../src/lib/process.ts";
import { setEnv, tempFolder, writeFiles } from "../helpers/sandbox.ts";

// The child gives up after 3s by itself, so a missing stdin end fails this test instead of hanging the run.
const WAITS_FOR_STDIN = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); setTimeout(() => process.exit(3), 3000);";

test("a program that reads stdin sees it end instead of waiting forever", async () => {
  const result = await runProcess(process.execPath, ["-e", WAITS_FOR_STDIN], tmpdir());
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
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

  const tools = await installTools(manifest);

  assert.ok(existsSync(tools));
  assert.equal(existsSync(ran), false);
});
