import { parseArgs } from "node:util";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { hookInput, opensPr, options, prOptions } from "../lib/gh-pr-create.ts";
import { stopRunning } from "../lib/process.ts";
import { COMMIT_SHA, isUsableRef, Repo, UnresolvedRef } from "../lib/repo.ts";
import { markCommitReviewed, reviewedBase, reviewedCommit, revokeReview, WHOLE_REPO } from "../lib/review-record.ts";
import { shellCommands } from "../lib/shell-commands.ts";

/** The branch the PR names as its head, read the way gh reads it. */
function headBranch(words: string[]): string | undefined {
  return options(words).found.find(([name]) => name === "head")?.[1];
}

type PassOptions = { branch?: string; verdict?: string; head?: string; base?: string };

/** The options `pr-gate pass` was given, or why they cannot be read. */
function passOptions(args: string[]): PassOptions | string {
  try {
    const options = { branch: { type: "string" }, verdict: { type: "string" }, head: { type: "string" }, base: { type: "string" } } as const;
    return parseArgs({ args, options, strict: true }).values;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// Claude Code lets the command run when the hook passes the 30-second timeout in hooks/hooks.json, so the gate decides
// within 20 seconds whatever stalls, the hook's stdin or git, and past that refuses and stops the git it started.
// The other 10 cover bin/coherence's node probe (up to 5), node starting and main.ts exiting.
export const HOOK_DEADLINE_MS = 20_000;

const UNREADABLE_HOOK =
  "coherence pr-gate could not read the hook input, so it cannot tell whether this command opens a PR. " +
  "Claude Code's hook format may have changed: update or disable the coherence plugin.";

/** Refuses to open a pull request unless the commit it would publish has had a coherence review, and records when one has. */
export class PrGateCommand extends BaseCommand {
  readonly name = "pr-gate";
  readonly usage =
    "coherence pr-gate [pass --branch <name> --verdict <call> --head <commit id> [--base <commit id>]]  (PreToolUse hook on stdin; pass records that the review approved HEAD)";

  /** The `check` command, which `pass` runs again before recording. Commands may not import each other, so main.ts hands it over. */
  private readonly check: BaseCommand;

  private readonly deadlineMs: number;

  constructor(check: BaseCommand, deadlineMs = HOOK_DEADLINE_MS) {
    super();
    this.check = check;
    this.deadlineMs = deadlineMs;
  }

  async execute(invocation: Invocation): Promise<number> {
    const [verb] = invocation.args;
    if (verb === "pass") return this.pass(invocation);
    if (verb !== undefined) return this.refuse(invocation);

    // Past the deadline the hook has answered, so a late decision must not print a second answer.
    let late = false;
    const guarded: Invocation = { ...invocation, print: (line) => late || invocation.print(line) };
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<number>((resolve) => {
      timer = setTimeout(() => {
        late = true;
        stopRunning();
        resolve(this.cannotCheck(invocation, `deciding took longer than ${this.deadlineMs / 1000} seconds`));
      }, this.deadlineMs);
    });
    try {
      return await Promise.race([this.decide(guarded), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The hook's answer for the Bash line on stdin: silence lets it run, a printed deny refuses it. */
  private async decide(invocation: Invocation): Promise<number> {
    // Stdin that cannot be read is input the gate cannot read, so it is refused the same way.
    const hook = hookInput(await invocation.readStdin().catch(() => ""));
    // Claude Code always sends this, so input without it means the hook protocol changed; guessing at it would let PRs through.
    if (!hook) {
      this.deny(invocation, UNREADABLE_HOOK);
      return Exit.ok;
    }
    if (!opensPr(hook.command, shellCommands(hook.command))) return Exit.ok;
    const pr = prOptions(hook.command);
    if ("why" in pr) return this.cannotCheck(invocation, pr.why);

    // Once a PR is being opened, anything that stops the gate judging it refuses the PR instead of letting it through.
    return this.judge(invocation, hook.cwd ?? invocation.cwd, pr.args).catch((error: unknown) =>
      this.cannotCheck(invocation, error instanceof Error ? error.message : String(error)),
    );
  }

  private async judge(invocation: Invocation, cwd: string, args: string[]): Promise<number> {
    const repo = await Repo.open(cwd);
    const branch = headBranch(args) ?? (await repo.currentBranch());
    if (!branch) return this.cannotCheck(invocation, "HEAD is detached. Check out the PR's branch, or name it with --head, then open the PR again");
    const tip = await repo.branchCommit(branch);
    if (!tip) return this.cannotCheck(invocation, `branch ${branch} has no local commit here. Check out or fetch the branch, then open the PR again`);

    const reviewed = await reviewedCommit(repo, branch);
    if (reviewed === tip) {
      const why = await this.baseMismatch(repo, branch, args);
      if (!why) return Exit.ok;
      this.deny(invocation, `PR refused by coherence: ${why}. Skipping review is the owner's decision, not yours.`);
      return Exit.ok;
    }

    const why = reviewed ? `commits landed on branch ${branch} after its coherence review` : `branch ${branch} has not had a coherence review`;
    this.deny(
      invocation,
      `PR refused by coherence: ${why}. Run /coherence:review <base>, fix what is real, ` +
        `then open the PR again. Skipping review is the owner's decision, not yours.`,
    );
    return Exit.ok;
  }

  /**
   * Why the PR's base is not the one the review read, or undefined when it is. A review of the whole repo covers any base. A
   * review with no readable base, such as one recorded by an earlier version, cannot say what it covered, so it covers none.
   * Otherwise the PR must name its base, and that base must be the reviewed one, or the PR would publish a diff the review never read.
   *
   * Comparing against the base on GitHub was considered, because the PR's diff is taken from GitHub's branch, not the local one.
   * It was rejected because the hook would need network calls and credentials to make it, and the remote can still move
   * between the check and the PR. The base is compared in the local clone; branch protection is the hard enforcement.
   */
  private async baseMismatch(repo: Repo, branch: string, args: string[]): Promise<string | undefined> {
    const reviewed = await reviewedBase(repo, branch);
    if (reviewed === WHOLE_REPO) return undefined;
    if (!reviewed) return `the coherence review of branch ${branch} records no base it was reviewed against. Run /coherence:review <base> again with the PR's base`;
    const short = reviewed.slice(0, 8);
    const again = `Run /coherence:review <base> against the PR's base, or open the PR with --base naming a branch at the reviewed base ${short}`;
    const named = options(args).found.filter(([name]) => name === "base");
    if (named.length === 0) return `branch ${branch} was reviewed against ${short}, and the PR does not name its base. ${again}`;
    if (named.length > 1) return "the PR's base is named more than once. Name it once, with --base <branch>";
    const base = named[0][1] ?? "";
    // gh's --base is always a branch, so only the local branch of that name counts; a tag or a commit ID that git would find first does not.
    if (!isUsableRef(base)) return `the PR's base ${base.slice(0, 80)} is not a plain branch name. ${again}`;
    const baseId = await repo.branchCommit(base);
    if (!baseId) return `the PR's base ${base} has no local branch here, so the gate cannot tell whether the review read this diff. Fetch or create the local branch ${base}, then open the PR again`;
    if (baseId !== reviewed) return `branch ${branch} was reviewed against ${short}, but the PR's base ${base} is ${baseId.slice(0, 8)}, so the PR holds changes the review never read. ${again}`;
    return undefined;
  }

  /**
   * Records a review only when it approved exactly the commit at HEAD, and the rules still find nothing there.
   * Every call first revokes the reviewed branch's earlier approval, whatever is checked out now, so a later review
   * that does not approve leaves none behind.
   */
  private async pass(invocation: Invocation): Promise<number> {
    const options = passOptions(invocation.args.slice(1));
    if (typeof options === "string") return this.refusePass(invocation, options, Exit.usage);
    const { branch, verdict, head, base } = options;
    if (branch === undefined) return this.refusePass(invocation, "it needs --branch, the branch that was reviewed", Exit.usage);
    if (!isUsableRef(branch)) return this.refusePass(invocation, `--branch is not a usable branch name: ${branch.slice(0, 80)}`, Exit.usage);
    const repo = await Repo.open(invocation.cwd);
    await revokeReview(repo, branch);

    if (verdict === undefined || head === undefined) return this.refusePass(invocation, "it needs --verdict and --head", Exit.usage);
    if (verdict !== "merge") return this.refusePass(invocation, `the verdict was "${verdict}", so ${branch} is left with no recorded review`);
    if (!COMMIT_SHA.test(head)) return this.refusePass(invocation, `--head must be a full commit ID, not ${head.slice(0, 80)}`, Exit.usage);
    const checkedOut = await repo.currentBranch();
    if (checkedOut !== branch) return this.refusePass(invocation, `${checkedOut ? `branch ${checkedOut}` : "a detached HEAD"} is checked out, not the reviewed ${branch}`);
    const current = await repo.headCommit();
    if (head !== current) return this.refusePass(invocation, `HEAD is now ${current}, not the reviewed ${head}. Review again`);
    // The checks read the working tree, so it must hold exactly the reviewed commit.
    if (await repo.hasUncommittedChanges()) return this.refusePass(invocation, "the working tree has uncommitted changes or untracked files, so it is not the reviewed commit");
    // A --base that no longer resolves is a refusal with a reason; a failure of git itself is not the ref's fault.
    const baseId = base === undefined ? undefined : await repo.resolveCommit(base).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (baseId instanceof UnresolvedRef) return this.refusePass(invocation, baseId.message, Exit.usage);
    if (baseId instanceof Error) return this.refusePass(invocation, `git failed while resolving --base ${base}: ${baseId.message}`, Exit.failed);
    if (baseId === head) return this.refusePass(invocation, "--base is the reviewed commit itself, so the review saw an empty diff", Exit.usage);
    // Over the same scope the review used, so the recorded base and the checked base are one commit.
    const checked = await this.check
      .execute({ ...invocation, args: baseId ? ["--base", baseId] : [] })
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    // A crash or a failed tool is not a finding, and must not be reported as one.
    if (typeof checked === "string" || (checked !== Exit.ok && checked !== Exit.findings)) {
      const why = typeof checked === "string" ? checked : `coherence check exited ${checked}`;
      return this.refusePass(invocation, `checks could not run: ${why}`, Exit.failed);
    }
    if (checked === Exit.findings) return this.refusePass(invocation, "coherence check reports findings, listed above. Fix them and review again");
    // A commit, checkout or edit while the checks ran means they may not have read the reviewed commit.
    // A file edited and put back inside that window still slips through; checking a separate worktree would close it, and that is an accepted limit.
    const after = { branch: await repo.currentBranch(), head: await repo.headCommit(), dirty: await repo.hasUncommittedChanges() };
    if (after.branch !== branch || after.head !== head || after.dirty) {
      return this.refusePass(invocation, "the branch, HEAD or working tree changed while the checks ran. Review again");
    }

    await markCommitReviewed(repo, branch, head, baseId);
    invocation.print(`recorded a coherence review for ${branch} at ${head.slice(0, 8)}`);
    return Exit.ok;
  }

  private refusePass(invocation: Invocation, why: string, code: number = Exit.findings): number {
    invocation.printError(`coherence pr-gate pass refused: ${why}.`);
    return code;
  }

  private cannotCheck(invocation: Invocation, why: string): number {
    this.deny(invocation, `PR refused by coherence, which could not check it: ${why}.`);
    return Exit.ok;
  }
}
