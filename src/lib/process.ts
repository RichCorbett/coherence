import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProcessResult = { code: number; stdout: string; stderr: string };

// Large repos make git and the npx tools print a lot; the default buffer would kill them mid-run.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

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
  // Not under the system temp folder: npx also searches every parent of its working folder, and other users can write to /tmp.
  const parent = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "coherence");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(join(parent, prefix));
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
