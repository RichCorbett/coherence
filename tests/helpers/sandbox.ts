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
