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

// The words that open a PR, in order, for hook input too broken to read the command from.
const MAY_OPEN_PR = /\bgh\b[\s\S]*?\bpr\b[\s\S]*?\bcreate\b/;

/** Every string in a parsed JSON value, so text the payload escaped is read as it decodes. */
function jsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return value && typeof value === "object" ? Object.values(value).flatMap(jsonStrings) : [];
}

/** The command and folder a PreToolUse hook names, or the text to search when the input is not a hook payload. */
function hookInput(stdin: string): { command: string; cwd?: string } | { unreadable: string } {
  try {
    const hook = JSON.parse(stdin);
    if (typeof hook?.tool_input?.command !== "string") return { unreadable: jsonStrings(hook).join("\n") };
    return { command: hook.tool_input.command, cwd: typeof hook.cwd === "string" && hook.cwd !== "" ? hook.cwd : undefined };
  } catch {
    return { unreadable: stdin };
  }
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

    const hook = hookInput(await invocation.readStdin());
    // The hook runs on every shell command, so unreadable input is refused only when it could be opening a PR.
    if ("unreadable" in hook) {
      return MAY_OPEN_PR.test(hook.unreadable) ? this.cannotCheck(invocation, "the hook input was not JSON naming a tool_input.command") : Exit.ok;
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

  private cannotCheck(invocation: Invocation, why: string): number {
    this.deny(invocation, `PR refused by coherence, which could not check it: ${why}.`);
    return Exit.ok;
  }

  private refuse(invocation: Invocation): number {
    invocation.printError(`usage: ${this.usage}`);
    return Exit.usage;
  }
}
