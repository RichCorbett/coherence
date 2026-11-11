import { execFileSync } from "node:child_process";
import type { Invocation } from "../../src/lib/base-command.ts";
import { Repo } from "../../src/lib/repo.ts";
import { tempFolder, writeFiles, type Files } from "./sandbox.ts";

/** Runs git in `root` and returns what it printed, trimmed. */
export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: root, stdio: "pipe", encoding: "utf8" }).trim();
}

/** A real git repository holding `files` in one commit on `main`. */
export async function tempRepo(files: Files): Promise<Repo> {
  const root = tempFolder();
  git(root, "init", "-q", "-b", "main");
  writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "start");
  return Repo.open(root);
}

/** An invocation that captures what a command prints instead of writing to the terminal. */
export function fakeInvocation(
  cwd: string,
  args: string[] = [],
  stdin = "",
): Invocation & { printed: string[]; errors: string[] } {
  const printed: string[] = [];
  const errors: string[] = [];
  return { args, cwd, printed, errors, readStdin: async () => stdin, print: (line) => printed.push(line), printError: (line) => errors.push(line) };
}
