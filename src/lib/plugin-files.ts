import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** The folder the plugin's own files live in. An installed plugin gets it from Claude Code; tests point it elsewhere. */
function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? resolve(import.meta.dirname, "../..");
}

export function readPluginFile(path: string): Promise<string> {
  return readFile(join(pluginRoot(), path), "utf8");
}
