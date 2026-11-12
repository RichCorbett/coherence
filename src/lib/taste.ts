import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readPluginFile } from "./plugin-files.ts";

const RULES_HEADING = "## Rules condensed so far";
const ENTRIES_HEADING = "## Entries not yet condensed";

/** The owner's taste: the style the plugin ships, then their preferences, each kind under its own heading. */
export async function readTaste(): Promise<string> {
  const parts = [(await readPluginFile("taste/style.md")).trim()];
  // Condensing replaces only the rules, so a reader must be able to tell where each part starts.
  for (const [heading, path] of [[RULES_HEADING, rulesPath()], [ENTRIES_HEADING, logPath()]]) {
    if (existsSync(path)) parts.push(`${heading}\n\n${(await readFile(path, "utf8")).trim()}`);
  }
  return `${parts.join("\n\n")}\n`;
}

/** Records one preference as a dated entry and returns how many entries now wait to be condensed. */
export async function appendTaste(preference: string): Promise<number> {
  await mkdir(dirname(logPath()), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await appendFile(logPath(), `- ${today} ${preference}\n`);
  return (await readEntries()).length;
}

/** Removes the newest entry and returns it, or undefined when the log is empty. */
export async function undoLastTaste(): Promise<string | undefined> {
  const entries = await readEntries();
  const last = entries.pop();
  if (last !== undefined) await writeFile(logPath(), asLines(entries));
  return last;
}

/** Replaces the condensed rules, archives the entries they absorbed, and returns how many that was. */
export async function condenseTaste(rules: string): Promise<number> {
  await mkdir(dirname(logPath()), { recursive: true });
  const entries = await readEntries();
  // The rewrite is lossy, so the rules it replaces are kept; the archive already keeps the entries whole, with their dates.
  await backUpRules();
  // In this order so a crash can leave an entry in two places but never lose a preference.
  await writeFile(rulesPath(), `${rules.trim()}\n`);
  await appendFile(archivePath(), asLines(entries));
  await rm(logPath(), { force: true });
  return entries.length;
}

// Written under a temporary name and renamed, so a backup exists only once it is complete.
async function backUpRules(): Promise<void> {
  if (!existsSync(rulesPath())) return;
  // Milliseconds and a random suffix, so two condenses in the same second never share a name and overwrite a backup.
  const stamp = `${new Date().toISOString().replace(/:/g, "-")}-${randomUUID().slice(0, 8)}`;
  const temporary = configFile(`taste-rules.${stamp}.tmp`);
  await copyFile(rulesPath(), temporary);
  await rename(temporary, configFile(`taste-rules.${stamp}.md`));
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
