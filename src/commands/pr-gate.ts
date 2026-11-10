import { basename } from "node:path";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";
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

function headBranch(args: string[]): string | undefined {
  const named = args.findIndex((word) => word === "--head" || word === "-H");
  return named !== -1 ? args[named + 1] : args.find((word) => word.startsWith("--head="))?.slice("--head=".length);
}

/** Refuses to open a pull request unless the commit it would publish has had a coherence review, and records when one has. */
export class PrGateCommand extends BaseCommand {
  readonly name = "pr-gate";
  readonly usage = "coherence pr-gate [pass]  (PreToolUse hook on stdin; pass records that the current commit was reviewed)";

  async execute(invocation: Invocation): Promise<number> {
    const [verb] = invocation.args;
    if (verb === "pass") return this.pass(invocation);
    if (verb !== undefined) return this.refuse(invocation);

    const hook = JSON.parse(await invocation.readStdin());
    const args = prCreateArgs(String(hook.tool_input?.command ?? ""));
    if (!args) return Exit.ok;

    // A hook that fails here would break an unrelated command, and with no branch there is nothing to hold to account.
    const repo = await Repo.open(hook.cwd ?? invocation.cwd).catch(() => undefined);
    const branch = headBranch(args) ?? (await repo?.currentBranch());
    const tip = branch && (await repo?.branchCommit(branch));
    if (!repo || !branch || !tip) return Exit.ok;

    const reviewed = await repo.reviewedCommit(branch);
    if (reviewed === tip) return Exit.ok;

    const root = process.env.CLAUDE_PLUGIN_ROOT;
    const coherence = root ? `${root}/bin/coherence` : "coherence";
    const why = reviewed ? `commits landed on branch ${branch} after its coherence review` : `branch ${branch} has not had a coherence review`;
    this.deny(
      invocation,
      `PR refused by coherence: ${why}. Run /coherence:review <base>, fix what is real, ` +
        `then open the PR again. For a trivial change such as docs only, tell the owner and run ${coherence} pr-gate pass.`,
    );
    return Exit.ok;
  }

  private async pass(invocation: Invocation): Promise<number> {
    const repo = await Repo.open(invocation.cwd);
    const branch = await repo.currentBranch();
    if (!branch) return this.refuse(invocation);
    await repo.markCommitReviewed(branch);
    invocation.print(`recorded a coherence review for ${branch} at ${(await repo.headCommit()).slice(0, 8)}`);
    return Exit.ok;
  }

  private refuse(invocation: Invocation): number {
    invocation.printError(`usage: ${this.usage}`);
    return Exit.usage;
  }
}
