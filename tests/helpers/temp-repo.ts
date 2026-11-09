import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Invocation } from "../../src/lib/base-command.ts";
import { Repo } from "../../src/lib/repo.ts";

export type Files = Record<string, string>;

export function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: root, stdio: "pipe" });
}

export function writeFiles(root: string, files: Files): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A real git repository holding `files` in one commit on `main`. */
export async function tempRepo(files: Files): Promise<Repo> {
  const root = mkdtempSync(join(tmpdir(), "coherence-test-"));
  git(root, "init", "-q", "-b", "main");
  writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "start");
  return Repo.open(root);
}

/** An invocation that captures what a command prints instead of writing to the terminal. */
export function fakeInvocation(cwd: string, args: string[] = [], stdin = ""): Invocation & { printed: string[] } {
  const printed: string[] = [];
  return { args, cwd, printed, readStdin: async () => stdin, print: (line) => printed.push(line) };
}
