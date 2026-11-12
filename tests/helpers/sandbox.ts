import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

export type Files = Record<string, string>;

export function tempFolder(): string {
  return mkdtempSync(join(tmpdir(), "coherence-test-"));
}

export function writeFiles(root: string, files: Files): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** Enough small script files, each with a long path, that naming them all on one command line passes the system's argument limit. */
export function filesPastArgMax(): Files {
  const argMax = Number(execFileSync("getconf", ["ARG_MAX"], { encoding: "utf8" }));
  const folder = Array.from({ length: 3 }, (_, i) => `${i}`.padEnd(200, "d")).join("/");
  const count = Math.ceil(argMax / folder.length) + 100;
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`${folder}/f${i}.ts`, "export {};\n"]));
}

/** Sets environment variables for one test and puts them back afterwards. */
export function setEnv(t: TestContext, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
  }
}

/** A plugin folder holding `pluginFiles` and an empty config home, both wired in for one test. Returns the config home. */
export function isolatedPlugin(t: TestContext, pluginFiles: Files): string {
  const plugin = tempFolder();
  const config = tempFolder();
  writeFiles(plugin, pluginFiles);
  setEnv(t, { CLAUDE_PLUGIN_ROOT: plugin, XDG_CONFIG_HOME: config });
  return config;
}
