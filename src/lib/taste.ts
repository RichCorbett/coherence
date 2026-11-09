import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type Verdict = "accepted" | "rejected";

/** The folder the plugin's own files live in. An installed plugin gets it from Claude Code; tests point it elsewhere. */
function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? resolve(import.meta.dirname, "../..");
}

export function readPluginFile(path: string): Promise<string> {
  return readFile(join(pluginRoot(), path), "utf8");
}

// Outside the plugin because an installed plugin is a cached copy that an update overwrites.
function tasteLogPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "coherence", "taste-log.md");
}

/** The owner's taste: the style the plugin ships, then the personal log of findings accepted or rejected. */
export async function readTaste(): Promise<string> {
  const style = await readPluginFile("taste/style.md");
  const logPath = tasteLogPath();
  if (!existsSync(logPath)) return style;
  return `${style.trimEnd()}\n\n${(await readFile(logPath, "utf8")).trimEnd()}\n`;
}

export async function appendTaste(verdict: Verdict, finding: string): Promise<void> {
  const logPath = tasteLogPath();
  await mkdir(dirname(logPath), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await appendFile(logPath, `- ${today} ${verdict}: ${finding}\n`);
}
