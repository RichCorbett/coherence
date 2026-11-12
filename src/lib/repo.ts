import { join } from "node:path";
import { MAX_OUTPUT_MB, type ProcessResult, runProcess } from "./process.ts";

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|c|h|cc|cpp|swift)$/;

// Nobody reads these to follow how the system works, so they are not held to the standard.
const NOT_HAND_WRITTEN = /(^|\/)(node_modules|vendor|dist|build|fixtures)\//;

// A folder in the repo under review can pose as a repository of its own, and its config can name a command for git to run.
const REFUSE_PLANTED_REPOSITORIES = ["-c", "safe.bareRepository=explicit", "-c", "core.fsmonitor=false"];

export function git(args: string[], cwd: string): Promise<ProcessResult> {
  return runProcess("git", [...REFUSE_PLANTED_REPOSITORIES, ...args], cwd);
}

// A ref from a person or a skill is checked before git sees it, so it can never pass for an option or carry shell syntax along.
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

/** True for a ref that is plainly a name: it can never pass for an option or carry shell syntax. */
export function isUsableRef(ref: string): boolean {
  return !ref.startsWith("-") && SAFE_REF.test(ref);
}

/** A full commit ID, never an abbreviation that could come to name a different commit. */
export const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function firstLine(text: string): string {
  return text.trim().split("\n")[0];
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
    // Untracked files count too: the checks run when code is written, usually before `git add`. Ignored files stay out.
    const files = await this.gitPaths(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    return files.filter((path) => SOURCE_FILE.test(path) && !NOT_HAND_WRITTEN.test(path));
  }

  /** Files changed since the branch left `base`; deleted files have nothing left to check. */
  changedFiles(base: string): Promise<string[]> {
    return this.gitPaths(["diff", "--name-only", "-z", "--diff-filter=d", "--end-of-options", `${base}...HEAD`]);
  }

  /** The commit ID `ref` names. Throws on a ref that is not plainly a name, or that is not a commit. */
  async resolveCommit(ref: string): Promise<string> {
    if (!isUsableRef(ref)) throw new Error(`not a usable ref name: ${ref.slice(0, 80)}`);
    const result = await git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], this.root);
    if (result.code !== 0) throw new Error(`${ref} is not a commit: ${firstLine(result.stderr)}`);
    return result.stdout.trim();
  }

  /** The full patch between two commit IDs, deleted files included. Never runs a diff or textconv command named by the repo. */
  patchBetween(baseId: string, headId: string): Promise<string> {
    return this.diffBetween(baseId, headId, []);
  }

  /** The `--stat` summary of the same change. */
  statBetween(baseId: string, headId: string): Promise<string> {
    return this.diffBetween(baseId, headId, ["--stat"]);
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

  /** True when the working tree is not exactly HEAD: a changed tracked file, staged or not, or an untracked file that is not ignored. */
  async hasUncommittedChanges(): Promise<boolean> {
    const result = await git(["status", "--porcelain", "--untracked-files=normal"], this.root);
    if (result.code !== 0) throw new Error(`git status failed: ${firstLine(result.stderr)}`);
    return result.stdout.trim() !== "";
  }

  private async diffBetween(baseId: string, headId: string, extra: string[]): Promise<string> {
    const args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", ...extra, `${baseId}...${headId}`, "--"];
    // Past the output limit the process is killed and the diff is lost, so say that instead of surfacing the raw error.
    const result = await git(args, this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw error;
      throw new Error(`the diff is over the ${MAX_OUTPUT_MB} MB limit and cannot be read`);
    });
    if (result.code !== 0) throw new Error(`git diff failed: ${firstLine(result.stderr)}`);
    return result.stdout;
  }

  private async gitPaths(args: string[]): Promise<string[]> {
    const result = await git(args, this.root);
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout.split("\0").filter(Boolean);
  }
}
