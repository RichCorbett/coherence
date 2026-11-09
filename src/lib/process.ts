import { execFile } from "node:child_process";

export type ProcessResult = { code: number; stdout: string; stderr: string };

// Large repos make git and the npx tools print a lot; the default buffer would kill them mid-run.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Runs a program to completion. A non-zero exit is a result to inspect, not an error. */
export function runProcess(command: string, args: string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
  });
}
