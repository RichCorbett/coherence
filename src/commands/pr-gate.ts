import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";

const OPENS_PR = /\bgh\s+pr\s+create\b/;

/** Refuses to open a pull request from a branch that has not had a coherence review, and records when one has. */
export class PrGateCommand extends BaseCommand {
  readonly name = "pr-gate";
  readonly usage = "coherence pr-gate [pass]  (PreToolUse hook on stdin; pass records that this branch was reviewed)";

  async execute(invocation: Invocation): Promise<number> {
    const [verb] = invocation.args;
    if (verb === "pass") return this.pass(invocation);
    if (verb !== undefined) return this.refuse(invocation);

    const hook = JSON.parse(await invocation.readStdin());
    if (!OPENS_PR.test(String(hook.tool_input?.command ?? ""))) return Exit.ok;

    // A hook that fails here would break an unrelated command, and with no branch there is nothing to hold to account.
    const repo = await Repo.open(hook.cwd ?? invocation.cwd).catch(() => undefined);
    const branch = await repo?.currentBranch();
    if (!repo || !branch || (await repo.isBranchReviewed(branch))) return Exit.ok;

    const root = process.env.CLAUDE_PLUGIN_ROOT;
    const coherence = root ? `${root}/bin/coherence` : "coherence";
    this.deny(
      invocation,
      `PR refused by coherence: branch ${branch} has not had a coherence review. Run /coherence:review <base>, fix what is real, ` +
        `then open the PR again. For a trivial change such as docs only, tell the owner and run ${coherence} pr-gate pass.`,
    );
    return Exit.ok;
  }

  private async pass(invocation: Invocation): Promise<number> {
    const repo = await Repo.open(invocation.cwd);
    const branch = await repo.currentBranch();
    if (!branch) return this.refuse(invocation);
    await repo.markBranchReviewed(branch);
    invocation.print(`recorded a coherence review for ${branch}`);
    return Exit.ok;
  }

  private refuse(invocation: Invocation): number {
    invocation.printError(`usage: ${this.usage}`);
    return Exit.usage;
  }
}
