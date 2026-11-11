import { basename } from "node:path";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";
import { shellCommands } from "../lib/shell-commands.ts";

type PrCreate = { words: string[]; before: string[]; gh: string[]; args: string[] };

/** The command on a parsed line that opens a PR: all its words, those before `gh`, those after it, and those after `gh pr create`. Undefined when the line does not open a PR. Reads whole words, past any wrapper or `gh` option, so a mention in quoted text is never taken for the command. */
function prCreate(line: string[][]): PrCreate | undefined {
  for (const words of line) {
    const gh = words.findIndex((word) => basename(word) === "gh");
    const pr = gh === -1 ? -1 : words.indexOf("pr", gh);
    if (pr !== -1 && words[pr + 1] === "create") return { words, before: words.slice(0, gh), gh: words.slice(gh + 1), args: words.slice(pr + 2) };
  }
  return undefined;
}

const ON_ITS_OWN = "run gh pr create on its own, as a separate command from the repo's folder";

/** Whether `word` is a group of short options, such as `-H`, `-Hvalue` or `-dH`, that contains `letter`. */
function shortOption(word: string, letter: string): boolean {
  return /^-[A-Za-z]/.test(word) && word.includes(letter);
}

function namesHead(word: string): boolean {
  return word === "--head" || word.startsWith("--head=") || shortOption(word, "H");
}

/** Why the gate cannot judge this line, or undefined when it can. The hook runs before the whole line, so the gh command must be all the line runs, run directly, aimed at this folder's repository. Anything else could move HEAD, change folder or point gh elsewhere first. */
function unjudgeable(line: string[][], pr: PrCreate): string | undefined {
  const other = line.find((words) => words !== pr.words);
  if (other) return `the same line runs another command; ${ON_ITS_OWN}, and run ${other[0]} separately first`;
  const retarget =
    pr.words.find((word) => /^GH_(REPO|HOST)=/.test(word)) ??
    pr.gh.find((word) => word === "--repo" || word.startsWith("--repo=") || shortOption(word, "R"));
  if (retarget) return `${retarget} points gh at a repository the gate did not check; ${ON_ITS_OWN}`;
  const wrapper = pr.before.find((word) => !/^[A-Za-z_]\w*=/.test(word));
  if (wrapper) return `gh runs through ${wrapper}, which can change where it runs; ${ON_ITS_OWN}, without ${wrapper}`;
  const heads = pr.args.filter(namesHead);
  if (heads.length > 1 || heads.some((word) => shortOption(word, "H") && !word.startsWith("-H"))) {
    return "the PR's head is named more than once or inside a group of short options. Name it once, with --head <branch>";
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

/** The branch the PR names as its head, read the way gh reads it: `--head x`, `--head=x`, `-H x`, `-Hx` or `-H=x`. */
function headBranch(args: string[]): string | undefined {
  for (const [at, word] of args.entries()) {
    if (word === "--head" || word === "-H") return args[at + 1];
    if (word.startsWith("--head=")) return word.slice("--head=".length);
    if (word.startsWith("-H")) return word.slice(word.startsWith("-H=") && word.length > 3 ? 3 : 2);
  }
  return undefined;
}

const UNREADABLE_HOOK =
  "coherence pr-gate could not read the hook input, so it cannot tell whether this command opens a PR. " +
  "Claude Code's hook format may have changed: update or disable the coherence plugin.";

/** Refuses to open a pull request unless the commit it would publish has had a coherence review, and records when one has. */
export class PrGateCommand extends BaseCommand {
  readonly name = "pr-gate";
  readonly usage = "coherence pr-gate [pass]  (PreToolUse hook on stdin; pass records that the current commit was reviewed)";

  async execute(invocation: Invocation): Promise<number> {
    const [verb] = invocation.args;
    if (verb === "pass") return this.pass(invocation);
    if (verb !== undefined) return this.refuse(invocation);

    // Stdin that cannot be read is input the gate cannot read, so it is refused the same way.
    const hook = hookInput(await invocation.readStdin().catch(() => ""));
    // Claude Code always sends this, so input without it means the hook protocol changed; guessing at it would let PRs through.
    if (!hook) {
      this.deny(invocation, UNREADABLE_HOOK);
      return Exit.ok;
    }
    const line = shellCommands(hook.command);
    const pr = prCreate(line);
    if (!pr) return Exit.ok;
    const why = unjudgeable(line, pr);
    if (why) return this.cannotCheck(invocation, why);

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
