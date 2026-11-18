import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_OUTPUT_MB, type ProcessResult, runProcess } from "./process.ts";

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|c|h|cc|cpp|swift)$/;

// The files besides source that say how source files import each other: package manifests and TypeScript or JavaScript project files.
const PROJECT_FILE = /(^|\/)(package\.json|[tj]sconfig[^/]*\.json)$/;

// Nobody reads these to follow how the system works, so they are not held to the standard.
export const NOT_HAND_WRITTEN = /(^|\/)(node_modules|vendor|dist|build|fixtures)\//;

// A folder in the repo under review can pose as a repository of its own, and its config can name a command for git to run.
const REFUSE_PLANTED_REPOSITORIES = ["-c", "safe.bareRepository=explicit", "-c", "core.fsmonitor=false"];

// The tools that read the copy obey comments in the code that switch their findings off, and have no option to stop.
// In the copy those words are written in capitals, which neither obeys (measured 2026-11-17), so the code under review cannot
// silence the owner's checks; the length is the same, so every line and column stays where it was.
// Only where the word opens a comment in the file's language: //, /* or a block comment's leading *, or # in Python and Ruby, which
// only ast-grep reads. Opening means nothing but non-letters stand between: ast-grep skips any of them (spaces of every kind, *, -,
// digits, a newline in a block comment) and fallow skips Unicode spaces and *, but neither obeys the word after a letter (measured
// 2026-11-17). So a URL, an import path or a note that mentions it later stays as written, and so does a "#..." subpath import in
// JavaScript, where # opens no comment. A string holding an opener before the word, like "// ast-grep-ignore", is still rewritten:
// telling it from a comment takes a lexer for every language, and the cost is a rule missing that one literal, never a check
// switched off.
// The word comes first and the opener is looked for behind it: looking forward from every opener took time growing with the square
// of a line of slashes, 3.3s for 80 000 of them (measured 2026-11-17), and the copy is made inside every check that reads it.
const SLASH_SUPPRESSION =
  /(?:ast-grep-ignore|fallow-ignore)(?<=(?:\/\/[^\p{Alphabetic}\n]*|\/\*[^\p{Alphabetic}]*|^[^\S\n]*\*[^\p{Alphabetic}\n]*)(?:ast-grep-ignore|fallow-ignore))/gmu;
const HASH_SUPPRESSION = /ast-grep-ignore(?<=#[^\p{Alphabetic}\n]*ast-grep-ignore)/gu;
const HASH_COMMENTS = /\.(py|rb)$/;

/** Rewrites the tools' suppression comments in `file`, a copy, so that no tool obeys them. */
export async function disarmSuppressions(file: string): Promise<void> {
  const text = await readFile(file, "utf8");
  const suppression = HASH_COMMENTS.test(file) ? HASH_SUPPRESSION : SLASH_SUPPRESSION;
  const disarmed = text.replace(suppression, (word) => word.toUpperCase());
  if (disarmed !== text) await writeFile(file, disarmed);
}

function handWritten(paths: string[]): string[] {
  return paths.filter((path) => SOURCE_FILE.test(path) && !NOT_HAND_WRITTEN.test(path));
}

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

/** A ref that names no commit, as opposed to git failing to look. */
export class UnresolvedRef extends Error {}

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
    return (await this.splitSourceFiles()).kept;
  }

  /** The source files `sourceFiles()` leaves out, so a check can say what it did not cover. */
  async skippedSourceFiles(): Promise<string[]> {
    return (await this.splitSourceFiles()).skipped;
  }

  /** The source files at the commit where the branch left `base`. */
  async sourceFilesAtBranchPoint(base: string): Promise<string[]> {
    return handWritten(await this.gitPaths(["ls-tree", "-r", "-z", "--name-only", "--end-of-options", await this.branchPoint(base)]));
  }

  /**
   * Writes the files of the commit where the branch left `base` into `folder`, with no .git, and returns the folder they are in.
   * An export rather than a checkout: the working tree is untouched, and nothing in it is a repository whose config git would obey.
   */
  async exportBranchPoint(base: string, folder: string): Promise<string> {
    const tar = join(folder, "branch-point.tar");
    const tree = join(folder, "tree");
    const archived = await git(["archive", "--format=tar", "-o", tar, "--end-of-options", await this.branchPoint(base)], this.root);
    if (archived.code !== 0) throw new Error(`git archive failed: ${firstLine(archived.stderr)}`);
    await mkdir(tree);
    const unpacked = await runProcess("tar", ["-xf", tar, "-C", tree], folder);
    if (unpacked.code !== 0) throw new Error(`tar failed: ${firstLine(unpacked.stderr)}`);
    return tree;
  }

  /**
   * Copies the source files, and the package.json and tsconfig files that say how they import each other, into `folder`.
   * A copy rather than the working tree, for a tool that must never see the repo itself: it holds no .git whose config git would obey,
   * no config file of any tool, and only regular files whose real path is where git lists them, so no symlink leads out of the repo.
   * The source files' suppression comments are disarmed, so no tool's finding can be switched off from the code.
   */
  async copySourceFiles(folder: string): Promise<void> {
    const listed = await this.listedFiles();
    const realRoot = await realpath(this.root);
    const source = new Set(handWritten(listed));
    for (const path of [...source, ...listed.filter((path) => PROJECT_FILE.test(path))]) {
      const from = join(realRoot, path);
      if (!(await lstat(from).catch(() => undefined))?.isFile() || (await realpath(from)) !== from) continue;
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await copyFile(from, join(folder, path));
      if (source.has(path)) await disarmSuppressions(join(folder, path));
    }
  }

  private async branchPoint(base: string): Promise<string> {
    const point = await git(["merge-base", "--end-of-options", base, "HEAD"], this.root);
    if (point.code !== 0) throw new Error(`no common commit with ${base}: ${firstLine(point.stderr)}`);
    return point.stdout.trim();
  }

  /** Files changed since the branch left `base`; deleted files have nothing left to check. */
  changedFiles(base: string): Promise<string[]> {
    return this.gitPaths(["diff", "--name-only", "-z", "--diff-filter=d", "--end-of-options", `${base}...HEAD`]);
  }

  /** The commit ID `ref` names. Throws on a ref that is not plainly a name, or that is not a commit, and on a git failure. */
  async resolveCommit(ref: string): Promise<string> {
    if (!isUsableRef(ref)) throw new UnresolvedRef(`not a usable ref name: ${ref.slice(0, 80)}`);
    // With -q, git exits 1 when the ref names no commit and any other non-zero code when git itself failed.
    const result = await git(["rev-parse", "--verify", "-q", "--end-of-options", `${ref}^{commit}`], this.root);
    if (result.code === 1) throw new UnresolvedRef(`${ref} is not a commit`);
    if (result.code !== 0) throw new Error(`git rev-parse failed: ${firstLine(result.stderr)}`);
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
  /**
   * The text of `path` as committed at `commit`, or undefined when no regular file is there. A symlink or a folder at that path
   * counts as no file: the text must be what was committed, not whatever a link would lead to.
   */
  async committedFile(commit: string, path: string): Promise<string | undefined> {
    const listed = await git(["ls-tree", "-z", "--end-of-options", commit, "--", path], this.root);
    if (listed.code !== 0) throw new Error(`git ls-tree failed: ${firstLine(listed.stderr)}`);
    const [mode, type, blob] = listed.stdout.split("\t")[0].split(" ");
    if (type !== "blob" || !["100644", "100755"].includes(mode)) return undefined;
    const shown = await git(["cat-file", "blob", blob], this.root);
    if (shown.code !== 0) throw new Error(`git cat-file failed: ${firstLine(shown.stderr)}`);
    return shown.stdout;
  }

  /** The commit origin's default branch points at, as the clone last saw it, or undefined when origin/HEAD is not set. */
  async defaultBranchCommit(): Promise<string | undefined> {
    const result = await git(["rev-parse", "--verify", "-q", "refs/remotes/origin/HEAD^{commit}"], this.root);
    return result.code === 0 ? result.stdout.trim() : undefined;
  }

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

  /**
   * Every remote-tracking ref for the branch, as `[ref, commit]`, read from the local clone with no network: those of the same
   * name on each remote, and those its upstream and push destination name, whatever they are called. Throws when the branch
   * pushes to a remote that git keeps no tracking ref for, since what was pushed there cannot be seen.
   */
  async remoteBranchCommits(branch: string): Promise<[string, string][]> {
    // A pattern, so the name must be plain: a glob character in it would match other branches.
    if (!isUsableRef(branch)) throw new Error(`not a usable branch name: ${branch.slice(0, 80)}`);
    const config = await git(["for-each-ref", "--format=%(refname)%00%(upstream)%00%(upstream:remotename)%00%(push)%00%(push:remotename)", `refs/heads/${branch}`], this.root);
    if (config.code !== 0) throw new Error(`git for-each-ref failed: ${firstLine(config.stderr)}`);
    const [, upstream = "", upstreamRemote = "", push = "", pushRemote = ""] = config.stdout.split("\n").find((line) => line.startsWith(`refs/heads/${branch}\0`))?.split("\0") ?? [];
    // git names no push destination when `simple` would refuse the push, which is fine once the upstream on that same remote is known.
    // Any other remote with none named is one whose pushes leave no trace here. "." is this repository, which publishes nothing.
    if (pushRemote && pushRemote !== "." && !push && !(pushRemote === upstreamRemote && upstream)) {
      throw new Error(`branch ${branch} pushes to ${pushRemote.slice(0, 80)}, which keeps no remote-tracking ref for it here, so what was pushed there cannot be seen. Give the branch an upstream on a remote that fetches it (git push -u <remote> ${branch}), then open the PR again`);
    }
    // Exact names from the remotes git knows, since a remote's name can hold a slash, which `refs/remotes/*/<branch>` would not match.
    const remotes = await git(["remote"], this.root);
    if (remotes.code !== 0) throw new Error(`git remote failed: ${firstLine(remotes.stderr)}`);
    const wanted = new Set([upstream, push].filter((ref) => ref.startsWith("refs/remotes/")));
    for (const remote of remotes.stdout.split("\n").filter(Boolean)) wanted.add(`refs/remotes/${remote}/${branch}`);
    const result = await git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/"], this.root);
    if (result.code !== 0) throw new Error(`git for-each-ref failed: ${firstLine(result.stderr)}`);
    return result.stdout.split("\n").flatMap((line) => {
      const found = /^(\S+) ([0-9a-f]+)$/.exec(line);
      return found && wanted.has(found[1]) ? [[found[1], found[2]] as [string, string]] : [];
    });
  }

  /** The `remote.<name>.gh-resolved` values `gh repo set-default` stores, which steer gh's PRs to the repository they name, as `[remote, value]`. */
  async ghDefaults(): Promise<[string, string][]> {
    const result = await git(["config", "--get-regexp", String.raw`^remote\..*\.gh-resolved$`], this.root);
    // Exit 1 means no such key; anything else is git failing, and the answer is then unknown.
    if (result.code > 1) throw new Error(`git config failed: ${firstLine(result.stderr)}`);
    return result.stdout.split("\n").flatMap((line) => {
      const found = /^remote\.(.+)\.gh-resolved (.*)$/.exec(line);
      return found ? [[found[1], found[2]] as [string, string]] : [];
    });
  }

  /** The repository's shared git folder, the same for every worktree of it, so a worktree of the repo reads the repo's owner state. */
  async commonDir(): Promise<string> {
    const result = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], this.root);
    if (result.code !== 0) throw new Error(`git rev-parse failed: ${firstLine(result.stderr)}`);
    return result.stdout.trim();
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

  private async splitSourceFiles(): Promise<{ kept: string[]; skipped: string[] }> {
    const source = (await this.listedFiles()).filter((path) => SOURCE_FILE.test(path));
    return { kept: source.filter((path) => !NOT_HAND_WRITTEN.test(path)), skipped: source.filter((path) => NOT_HAND_WRITTEN.test(path)) };
  }

  private async listedFiles(): Promise<string[]> {
    // Untracked files count too: the checks run when code is written, usually before `git add`. Ignored files stay out.
    // A file deleted from the working tree stays in the index until the deletion is staged, and there is nothing left to check (#71).
    const deleted = new Set(await this.gitPaths(["ls-files", "-z", "--deleted"]));
    return (await this.gitPaths(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])).filter((path) => !deleted.has(path));
  }

  private async gitPaths(args: string[]): Promise<string[]> {
    const result = await git(args, this.root);
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout.split("\0").filter(Boolean);
  }
}
