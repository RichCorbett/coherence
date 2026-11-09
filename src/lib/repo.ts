import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "./process.ts";

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|c|h|cc|cpp|swift)$/;

// Nobody reads these to follow how the system works, so they are not held to the standard.
const NOT_HAND_WRITTEN = /(^|\/)(node_modules|vendor|dist|build|fixtures)\//;

function reviewedKey(branch: string): string {
  return `branch.${branch}.coherence-reviewed`;
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
    return this.gitPaths(["diff", "--name-only", "-z", "--diff-filter=d", "--end-of-options", `${base}...HEAD`]);
  }

  /** True when `path` is tracked and has no uncommitted changes. */
  async isCommitted(path: string): Promise<boolean> {
    const tracked = await runProcess("git", ["ls-files", "--error-unmatch", "--", path], this.root);
    if (tracked.code !== 0) return false;
    const changed = await runProcess("git", ["diff", "--quiet", "HEAD", "--", path], this.root);
    return changed.code === 0;
  }

  /** A repo path for another program. Being absolute, a filename starting with `-` cannot be read as an option. */
  absolutePath(path: string): string {
    return join(this.root, path);
  }

  /** The checked-out branch, or undefined on a detached HEAD. */
  async currentBranch(): Promise<string | undefined> {
    const result = await runProcess("git", ["branch", "--show-current"], this.root);
    return result.stdout.trim() || undefined;
  }

  // Kept in the repo's own git config, so it stays per clone and per branch and needs no file of ours.
  async isBranchReviewed(branch: string): Promise<boolean> {
    return (await runProcess("git", ["config", "--get", reviewedKey(branch)], this.root)).code === 0;
  }

  async markBranchReviewed(branch: string): Promise<void> {
    const result = await runProcess("git", ["config", reviewedKey(branch), "true"], this.root);
    if (result.code !== 0) throw new Error(`git config failed: ${result.stderr.trim()}`);
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
