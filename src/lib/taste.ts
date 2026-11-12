import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  // The rewrite is lossy, so keep what it replaces for `uncondense`. Only the latest condense can be taken back.
  await rm(prevRulesPath(), { force: true });
  if (existsSync(rulesPath())) await copyFile(rulesPath(), prevRulesPath());
  await writeFile(prevLogPath(), asLines(entries));
  // In this order so a crash can leave an entry in two places but never lose a preference.
  await writeFile(rulesPath(), `${rules.trim()}\n`);
  await appendFile(archivePath(), asLines(entries));
  await rm(logPath(), { force: true });
  return entries.length;
}

/** Puts back the rules and entries the last condense replaced and returns how many entries, or undefined when there is nothing to put back. */
export async function uncondenseTaste(): Promise<number | undefined> {
  if (!existsSync(prevLogPath())) return undefined;
  const entries = (await readFile(prevLogPath(), "utf8")).split("\n").filter(Boolean);
  if (existsSync(prevRulesPath())) await copyFile(prevRulesPath(), rulesPath());
  else await rm(rulesPath(), { force: true });
  // Entries recorded since the condense stay, after the restored ones.
  await writeFile(logPath(), asLines([...entries, ...(await readEntries())]));
  // Those entries were appended last, so they come off the archive's tail and are not archived twice.
  const archived = existsSync(archivePath()) ? await readFile(archivePath(), "utf8") : "";
  if (archived.endsWith(asLines(entries))) await writeFile(archivePath(), archived.slice(0, archived.length - asLines(entries).length));
  await rm(prevLogPath(), { force: true });
  await rm(prevRulesPath(), { force: true });
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

function prevRulesPath(): string {
  return configFile("taste-rules.prev.md");
}

function prevLogPath(): string {
  return configFile("taste-log.prev.md");
}

function archivePath(): string {
  return configFile("taste-archive.md");
}

// Outside the plugin because the owner's taste must survive a plugin update and never ship with the plugin.
function configFile(name: string): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "coherence", name);
}
