import { basename } from "node:path";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";
import { hiddenCode, shellCommands } from "../lib/shell-commands.ts";

type PrCreate = { words: string[]; before: string[]; gh: string[] };

/** The command on a parsed line that opens a PR: all its words, those before `gh`, and those after it. Undefined when the line does not open a PR. Reads whole words, past any wrapper or `gh` option, so a mention in quoted text is never taken for the command. */
function prCreate(line: string[][]): PrCreate | undefined {
  for (const words of line) {
    const gh = words.findIndex((word) => basename(word) === "gh");
    const pr = gh === -1 ? -1 : words.indexOf("pr", gh);
    if (pr !== -1 && words[pr + 1] === "create") return { words, before: words.slice(0, gh), gh: words.slice(gh + 1) };
  }
  return undefined;
}

const PRINTS = new Set(["cat", "echo", "printf"]);

/** Whether a command only prints text and writes no file, such as the `cat` of a heredoc that fills `--body`. Quotes are gone by now, so any `>` counts as a redirect. */
function onlyPrints(words: string[]): boolean {
  return PRINTS.has(words[0]) && !words.some((word) => word.includes(">"));
}

const ON_ITS_OWN ="run gh pr create on its own, as a separate command from the repo's folder";

/** gh pr create's options by short and long name, with the -R it inherits, from its `--help` as remembered rather than read from gh. */
const TAKES_VALUE = new Map([["a", "assignee"], ["B", "base"], ["b", "body"], ["F", "body-file"], ["H", "head"], ["l", "label"], ["m", "milestone"], ["p", "project"], ["r", "reviewer"], ["R", "repo"], ["T", "template"], ["t", "title"]]);
const TAKES_VALUE_LONG = new Set([...TAKES_VALUE.values(), "recover"]);
const SWITCHES = new Map([["d", "draft"], ["e", "editor"], ["f", "fill"], ["h", "help"], ["w", "web"]]);
const SWITCHES_LONG = new Set([...SWITCHES.values(), "dry-run", "fill-first", "fill-verbose", "no-maintainer-edit"]);

/**
 * The options gh would read from `words`, by long name, the way its flag parser reads them: `--name value`, `--name=value`,
 * `-x value`, `-xvalue`, `-x=value`, and groups such as `-dH value`. A word taken as a value is never read as an option.
 * Stops at the first option it does not know, since what follows it could be that option's value or another option.
 */
function options(words: string[]): { found: [string, string | undefined][]; unknown?: string } {
  const found: [string, string | undefined][] = [];
  for (let at = 0; at < words.length; at++) {
    const word = words[at];
    if (word === "--") break;
    if (word.startsWith("--")) {
      const [name, ...value] = word.slice(2).split("=");
      if (TAKES_VALUE_LONG.has(name)) found.push([name, value.length ? value.join("=") : words[++at]]);
      else if (SWITCHES_LONG.has(name)) found.push([name, undefined]);
      else return { found, unknown: word };
    } else if (word.length > 1 && word.startsWith("-")) {
      for (let i = 1; i < word.length; i++) {
        const name = TAKES_VALUE.get(word[i]);
        const rest = word.slice(i + 1);
        if (name) {
          found.push([name, rest === "" ? words[++at] : rest.length > 1 && rest.startsWith("=") ? rest.slice(1) : rest]);
          break;
        }
        const switched = SWITCHES.get(word[i]);
        if (!switched) return { found, unknown: word };
        found.push([switched, undefined]);
      }
    }
  }
  return { found };
}

/** Why the gate cannot judge this line, or undefined when it can. The hook runs before the whole line, so the gh command must be all the line runs besides commands that only print, run directly, aimed at this folder's repository. Anything else could move HEAD, change folder or point gh elsewhere first. */
function unjudgeable(raw: string, line: string[][], pr: PrCreate): string | undefined {
  const hidden = hiddenCode(raw);
  if (hidden) return `the line holds ${hidden}, which can change what runs; ${ON_ITS_OWN}`;
  const other = line.find((words) => words !== pr.words && !onlyPrints(words));
  if (other) return `the same line runs another command; ${ON_ITS_OWN}, and run ${other[0]} separately first`;
  const [first] = pr.before;
  if (first) return `${first} comes before gh, and can change where or how it runs; ${ON_ITS_OWN}, with nothing in front of gh`;
  const { found, unknown } = options(pr.gh);
  if (unknown) return `coherence does not know the option ${unknown}, so it cannot tell which branch the PR names; ${ON_ITS_OWN}, without it`;
  if (found.some(([name]) => name === "repo")) return `--repo points gh at a repository the gate did not check; ${ON_ITS_OWN}`;
  if (found.filter(([name]) => name === "head").length > 1) return "the PR's head is named more than once. Name it once, with --head <branch>";
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

/** The branch the PR names as its head, read the way gh reads it. */
function headBranch(words: string[]): string | undefined {
  return options(words).found.find(([name]) => name === "head")?.[1];
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
    const why = unjudgeable(hook.command, line, pr);
    if (why) return this.cannotCheck(invocation, why);

    // Once a PR is being opened, anything that stops the gate judging it refuses the PR instead of letting it through.
    return this.judge(invocation, hook.cwd ?? invocation.cwd, pr.gh).catch((error: unknown) =>
      this.cannotCheck(invocation, error instanceof Error ? error.message : String(error)),
    );
  }

  private async judge(invocation: Invocation, cwd: string, gh: string[]): Promise<number> {
    const repo = await Repo.open(cwd);
    const branch = headBranch(gh) ?? (await repo.currentBranch());
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
