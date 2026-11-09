import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "./process.ts";

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|c|h|cc|cpp|swift)$/;

// Nobody reads these to follow how the system works, so they are not held to the standard.
const NOT_HAND_WRITTEN = /(^|\/)(node_modules|vendor|dist|build|fixtures)\//;

/** A repo path safe to hand to another program: a filename starting with `-` must not be read as an option. */
export function asPathArgument(path: string): string {
  return `./${path}`;
}

/** The git repository under review. Every check sees the code through this one view. */
export class Repo {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async open(cwd: string): Promise<Repo> {
    const result = await runProcess("git", ["rev-parse", "--show-toplevel"], cwd);
    if (result.code !== 0) throw new Error(`not a git repository: ${cwd}`);
    return new Repo(result.stdout.trim());
  }

  async sourceFiles(): Promise<string[]> {
    const tracked = await this.gitPaths(["ls-files", "-z"]);
    return tracked.filter((path) => SOURCE_FILE.test(path) && !NOT_HAND_WRITTEN.test(path));
  }

  /** Files changed since the branch left `base`; deleted files have nothing left to check. */
  changedFiles(base: string): Promise<string[]> {
    return this.gitPaths(["diff", "--name-only", "-z", "--diff-filter=d", `${base}...HEAD`]);
  }

  /** True when `path` is tracked and has no uncommitted changes. */
  async isCommitted(path: string): Promise<boolean> {
    const tracked = await runProcess("git", ["ls-files", "--error-unmatch", "--", path], this.root);
    if (tracked.code !== 0) return false;
    const changed = await runProcess("git", ["diff", "--quiet", "HEAD", "--", path], this.root);
    return changed.code === 0;
  }

  async exists(path: string): Promise<boolean> {
    return access(join(this.root, path)).then(() => true, () => false);
  }

  read(path: string): Promise<string> {
    return readFile(join(this.root, path), "utf8");
  }

  private async gitPaths(args: string[]): Promise<string[]> {
    const result = await runProcess("git", args, this.root);
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout.split("\0").filter(Boolean);
  }
}
