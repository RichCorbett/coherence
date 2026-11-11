import { access } from "node:fs/promises";
import { join } from "node:path";
import { type ProcessResult, runProcess } from "./process.ts";

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|c|h|cc|cpp|swift)$/;

// Nobody reads these to follow how the system works, so they are not held to the standard.
const NOT_HAND_WRITTEN = /(^|\/)(node_modules|vendor|dist|build|fixtures)\//;

// A folder in the repo under review can pose as a repository of its own, and its config can name a command for git to run.
const REFUSE_PLANTED_REPOSITORIES = ["-c", "safe.bareRepository=explicit", "-c", "core.fsmonitor=false"];

function git(args: string[], cwd: string): Promise<ProcessResult> {
  return runProcess("git", [...REFUSE_PLANTED_REPOSITORIES, ...args], cwd);
}

// A ref from a person or a skill is checked before git sees it, so it can never pass for an option or carry shell syntax along.
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

const COMMIT_SHA = /^[0-9a-f]{40,64}$/;

function firstLine(text: string): string {
  return text.trim().split("\n")[0];
}

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
    const result = await git(["rev-parse", "--show-toplevel"], cwd);
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

  /** The commit ID `ref` names. Throws on a ref that is not plainly a name, or that is not a commit. */
  async resolveCommit(ref: string): Promise<string> {
    if (ref.startsWith("-") || !SAFE_REF.test(ref)) throw new Error(`not a usable ref name: ${ref.slice(0, 80)}`);
    const result = await git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], this.root);
    if (result.code !== 0) throw new Error(`${ref} is not a commit: ${firstLine(result.stderr)}`);
    return result.stdout.trim();
  }

  /** The full patch from `baseId` to HEAD, deleted files included. Never runs a diff or textconv command named by the repo. */
  patchSince(baseId: string): Promise<string> {
    return this.diffSince(baseId, []);
  }

  /** The `--stat` summary of the same change. */
  statSince(baseId: string): Promise<string> {
    return this.diffSince(baseId, ["--stat"]);
  }

  /** A repo path usable from any working folder. Being absolute, it also cannot be read as an option. */
  absolutePath(path: string): string {
    return join(this.root, path);
  }

  /** The checked-out branch, or undefined on a detached HEAD. */
  async currentBranch(): Promise<string | undefined> {
    const result = await git(["branch", "--show-current"], this.root);
    return result.stdout.trim() || undefined;
  }

  async headCommit(): Promise<string> {
    const result = await git(["rev-parse", "HEAD"], this.root);
    if (result.code !== 0) throw new Error(`git rev-parse failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  }

  async branchCommit(branch: string): Promise<string | undefined> {
    const result = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], this.root);
    return result.code === 0 ? result.stdout.trim() : undefined;
  }

  // Kept in the repo's own git config, so it stays per clone and per branch and needs no file of ours.
  // Earlier versions stored "true" for the whole branch; that is not a commit, so it counts as never reviewed.
  async reviewedCommit(branch: string): Promise<string | undefined> {
    const stored = (await git(["config", "--get", reviewedKey(branch)], this.root)).stdout.trim();
    return COMMIT_SHA.test(stored) ? stored : undefined;
  }

  /** Records that the commit now at HEAD was reviewed. */
  async markCommitReviewed(branch: string): Promise<void> {
    const result = await git(["config", reviewedKey(branch), await this.headCommit()], this.root);
    if (result.code !== 0) throw new Error(`git config failed: ${result.stderr.trim()}`);
  }

  async exists(path: string): Promise<boolean> {
    return access(this.absolutePath(path)).then(() => true, () => false);
  }

  private async diffSince(baseId: string, extra: string[]): Promise<string> {
    const result = await git(["diff", "--no-ext-diff", "--no-textconv", "--no-color", ...extra, `${baseId}...HEAD`, "--"], this.root);
    if (result.code !== 0) throw new Error(`git diff failed: ${firstLine(result.stderr)}`);
    return result.stdout;
  }

  private async gitPaths(args: string[]): Promise<string[]> {
    const result = await git(args, this.root);
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout.split("\0").filter(Boolean);
  }
}
