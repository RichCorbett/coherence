import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProcessResult = { code: number; stdout: string; stderr: string };

// Large repos make git and the npx tools print a lot; the default buffer would kill them mid-run.
export const MAX_OUTPUT_MB = 64;
const MAX_OUTPUT_BYTES = MAX_OUTPUT_MB * 1024 * 1024;

/** Runs a program to completion. A non-zero exit is a result to inspect, not an error. */
export function runProcess(command: string, args: string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
    // Nothing feeds these programs, and one that reads stdin would wait forever.
    child.stdin?.end();
  });
}

/**
 * Runs a pinned npm tool, fetched through npx because an installed plugin has no npm install step.
 * It runs from an empty folder because npx prefers a matching package in its working folder and obeys the .npmrc there,
 * and the repo under review must not be able to supply either.
 */
export async function runPinnedTool(args: string[]): Promise<ProcessResult> {
  return withTempFolder((folder) => runProcess("npx", ["--yes", ...args], folder));
}

/** A new private folder in coherence's own cache area, for the caller to remove. */
export async function makeCacheFolder(prefix: string): Promise<string> {
  const parent = cacheParent();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(join(parent, prefix));
}

function cacheParent(): string {
  // Not under the system temp folder: npx also searches every parent of its working folder, and other users can write to /tmp.
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "coherence");
}

/**
 * Removes folders made by `makeCacheFolder(prefix)` that were last touched over `maxAgeMs` ago.
 * It matches only its own prefix and only real folders, so nothing else in the cache and nothing a symlink points at is touched.
 * Returns how many it removed and how many it could not.
 */
export async function pruneCacheFolders(prefix: string, maxAgeMs: number): Promise<{ removed: number; failed: number }> {
  const parent = cacheParent();
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const folder = join(parent, entry.name);
    try {
      if (Date.now() - (await stat(folder)).mtimeMs <= maxAgeMs) continue;
      await rm(folder, { recursive: true, force: true });
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}

/** Gives `work` an empty folder and removes it afterwards, however `work` ends. */
export async function withTempFolder<T>(work: (folder: string) => Promise<T>): Promise<T> {
  const folder = await makeCacheFolder("run-");
  try {
    return await work(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
