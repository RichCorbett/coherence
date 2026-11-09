import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readPluginFile } from "./plugin-files.ts";

export const VERDICTS = ["accepted", "rejected"] as const;
export type Verdict = (typeof VERDICTS)[number];

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
