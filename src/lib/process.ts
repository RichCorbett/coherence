import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProcessResult = { code: number; stdout: string; stderr: string };

// Large repos make git and the npx tools print a lot; the default buffer would kill them mid-run.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Runs a program to completion, or rejects at the time limit. A non-zero exit is a result to inspect, not an error. */
export function runProcess(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    // SIGKILL because codex ignores the default SIGTERM while it waits.
    const options = { cwd, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" } as const;
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error?.killed && error.code === null) return reject(new Error(`${command} did not finish within ${timeoutMs}ms`));
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
    // Nothing feeds these programs, and codex exec will not start until its stdin ends.
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

/** Gives `work` an empty folder and removes it afterwards, however `work` ends. */
export async function withTempFolder<T>(work: (folder: string) => Promise<T>): Promise<T> {
  // Not under the system temp folder: npx also searches every parent of its working folder, and other users can write to /tmp.
  const parent = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "coherence");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const folder = await mkdtemp(join(parent, "run-"));
  try {
    return await work(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
