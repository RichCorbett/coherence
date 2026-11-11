import { basename } from "node:path";
import { parseArgs } from "node:util";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { COMMIT_SHA, isUsableRef, Repo } from "../lib/repo.ts";
import { shellCommands } from "../lib/shell-commands.ts";

/** The words after `gh pr create`, or undefined when the line does not open a PR. Reads whole words, past any wrapper or `gh` option, so a mention in quoted text is never taken for the command. */
function prCreateArgs(commandLine: string): string[] | undefined {
  for (const words of shellCommands(commandLine)) {
    const gh = words.findIndex((word) => basename(word) === "gh");
    const pr = gh === -1 ? -1 : words.indexOf("pr", gh);
    if (pr !== -1 && words[pr + 1] === "create") return words.slice(pr + 2);
  }
  return undefined;
}

/** The command and folder a PreToolUse hook names, or undefined when the input is not a hook payload. */
function hookInput(stdin: string): { command: string; cwd?: string } | undefined {
  try {
    const hook = JSON.parse(stdin);
    if (typeof hook?.tool_input?.command !== "string") return undefined;
    return { command: hook.tool_input.command, cwd: typeof hook.cwd === "string" && hook.cwd !== "" ? hook.cwd : undefined };
  } catch {
    return undefined;
  }
}

function headBranch(args: string[]): string | undefined {
  const named = args.findIndex((word) => word === "--head" || word === "-H");
  return named !== -1 ? args[named + 1] : args.find((word) => word.startsWith("--head="))?.slice("--head=".length);
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

  constructor(check: BaseCommand) {
    super();
    this.check = check;
  }

  async execute(invocation: Invocation): Promise<number> {
    const [verb] = invocation.args;
    if (verb === "pass") return this.pass(invocation);
    if (verb !== undefined) return this.refuse(invocation);

    const hook = hookInput(await invocation.readStdin());
    // Claude Code always sends this, so input without it means the hook protocol changed; guessing at it would let PRs through.
    if (!hook) {
      this.deny(invocation, UNREADABLE_HOOK);
      return Exit.ok;
    }
    const args = prCreateArgs(hook.command);
    if (!args) return Exit.ok;

    // Once a PR is being opened, anything that stops the gate judging it refuses the PR instead of letting it through.
    return this.judge(invocation, hook.cwd ?? invocation.cwd, args).catch((error: unknown) =>
      this.cannotCheck(invocation, error instanceof Error ? error.message : String(error)),
    );
  }

  private async judge(invocation: Invocation, cwd: string, args: string[]): Promise<number> {
    const repo = await Repo.open(cwd);
    const branch = headBranch(args) ?? (await repo.currentBranch());
    if (!branch) return this.cannotCheck(invocation, "HEAD is detached. Check out the PR's branch, or name it with --head, then open the PR again");
    const tip = await repo.branchCommit(branch);
    if (!tip) return this.cannotCheck(invocation, `branch ${branch} has no local commit here. Check out or fetch the branch, then open the PR again`);

    const reviewed = await repo.reviewedCommit(branch);
    if (reviewed === tip) return Exit.ok;

    const why = reviewed ? `commits landed on branch ${branch} after its coherence review` : `branch ${branch} has not had a coherence review`;
    this.deny(
      invocation,
      `PR refused by coherence: ${why}. Run /coherence:review <base>, fix what is real, ` +
        `then open the PR again. Skipping review is the owner's decision, not yours.`,
    );
    return Exit.ok;
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
    await repo.revokeReview(branch);

    if (verdict === undefined || head === undefined) return this.refusePass(invocation, "it needs --verdict and --head", Exit.usage);
    if (verdict !== "merge") return this.refusePass(invocation, `the verdict was "${verdict}", so ${branch} is left with no recorded review`);
    if (!COMMIT_SHA.test(head)) return this.refusePass(invocation, `--head must be a full commit ID, not ${head.slice(0, 80)}`, Exit.usage);
    const checkedOut = await repo.currentBranch();
    if (checkedOut !== branch) return this.refusePass(invocation, `${checkedOut ? `branch ${checkedOut}` : "a detached HEAD"} is checked out, not the reviewed ${branch}`);
    const current = await repo.headCommit();
    if (head !== current) return this.refusePass(invocation, `HEAD is now ${current}, not the reviewed ${head}. Review again`);
    // The checks read the working tree, so it must hold exactly the reviewed commit.
    if (await repo.hasUncommittedChanges()) return this.refusePass(invocation, "the working tree has uncommitted changes or untracked files, so it is not the reviewed commit");
    const baseId = base === undefined ? undefined : await repo.resolveCommit(base);
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

    await repo.markCommitReviewed(branch, head, baseId);
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

  private refuse(invocation: Invocation): number {
    invocation.printError(`usage: ${this.usage}`);
    return Exit.usage;
  }
}
