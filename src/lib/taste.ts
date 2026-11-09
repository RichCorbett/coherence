import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readPluginFile } from "./plugin-files.ts";

export const VERDICTS = ["accepted", "rejected"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The owner's taste: the style the plugin ships, the rules condensed so far, then the entries not yet condensed. */
export async function readTaste(): Promise<string> {
  const parts = [await readPluginFile("taste/style.md")];
  for (const path of [rulesPath(), logPath()]) {
    if (existsSync(path)) parts.push(await readFile(path, "utf8"));
  }
  return `${parts.map((part) => part.trim()).filter(Boolean).join("\n\n")}\n`;
}

/** Records one decision and returns how many entries now wait to be condensed. */
export async function appendTaste(verdict: Verdict, finding: string): Promise<number> {
  await mkdir(dirname(logPath()), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await appendFile(logPath(), `- ${today} ${verdict}: ${finding}\n`);
  return (await readEntries()).length;
}

/** Removes the newest entry and returns it, or undefined when the log is empty. */
export async function undoLastEntry(): Promise<string | undefined> {
  const entries = await readEntries();
  const last = entries.pop();
  if (last !== undefined) await writeFile(logPath(), asLines(entries));
  return last;
}

/** Replaces the condensed rules, archives the entries they absorbed, and returns how many that was. */
export async function condenseTaste(rules: string): Promise<number> {
  await mkdir(dirname(logPath()), { recursive: true });
  const entries = await readEntries();
  // In this order so a crash can leave an entry in two places but never lose a preference.
  await writeFile(rulesPath(), `${rules.trim()}\n`);
  await appendFile(archivePath(), asLines(entries));
  await rm(logPath(), { force: true });
  return entries.length;
}

async function readEntries(): Promise<string[]> {
  if (!existsSync(logPath())) return [];
  return (await readFile(logPath(), "utf8")).split("\n").filter(Boolean);
}

function asLines(entries: string[]): string {
  return entries.map((entry) => `${entry}\n`).join("");
}

function logPath(): string {
  return configFile("taste-log.md");
}

function rulesPath(): string {
  return configFile("taste-rules.md");
}

function archivePath(): string {
  return configFile("taste-archive.md");
}

// Outside the plugin because the owner's taste must survive a plugin update and never ship with the plugin.
function configFile(name: string): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "coherence", name);
}
