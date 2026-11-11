import { basename } from "node:path";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";
import { HEREDOC_TEXT, shellCommands, staticWords } from "../lib/shell-commands.ts";

/** A word that is `gh`, or that the shell could still turn into `gh` by expanding it. */
const COULD_BE_GH = (word: string) => basename(word) === "gh" || /[$`*?[{\\]/.test(word);

/** Tokens of the raw line, wherever they sit: in quotes, heredoc bodies or substitutions. A hyphen or word character next to one makes it part of another word. */
const NAMES_PR_CREATE = /(?<![\w-])gh['"\s\\]+pr['"\s\\]+create(?![\w-])/;
const RUNS_TEXT = /(?<![\w-])(eval|(ba|z|da)?sh\s+-[a-z]*c)(?![\w-])/;
const NAMES_GH_OR_PR = /(?<![\w-])(gh|pr)(?![\w-])/;

/**
 * Whether a line could open a PR, so that it must be exactly `gh pr create` or be refused. Broad on purpose, so it also matches a
 * mention, such as one in a commit message. The raw text matches when it names `gh pr create` anywhere, or runs text as commands
 * through `eval` or `sh -c` and names `gh` or `pr`. A parsed command matches when `pr` and then `create` follow a word that is or
 * could become `gh`, such as `g[h]`, or when it starts with `pr`, where a substitution split it from its executable.
 */
function opensPr(raw: string, line: string[][]): boolean {
  if (NAMES_PR_CREATE.test(raw) || (RUNS_TEXT.test(raw) && NAMES_GH_OR_PR.test(raw))) return true;
  return line.some((words) => {
    const gh = words[0] === "pr" ? 0 : words.findIndex(COULD_BE_GH);
    const pr = gh === -1 ? -1 : words.indexOf("pr", gh);
    return pr !== -1 && words.indexOf("create", pr) !== -1;
  });
}

const ONE_COMMAND =
  "the line is not exactly one gh pr create command with fixed words. Run gh pr create on its own, from the repo's folder, " +
  "with nothing before gh, no other commands, and no variables, substitutions or wildcards; " +
  `a --body may be "$(cat <<'EOF' ... EOF)"`;

/** gh pr create's options by short and long name, with the -R it inherits, as `gh pr create --help` lists them on gh 2.103.2. */
const TAKES_VALUE = new Map([["a", "assignee"], ["B", "base"], ["b", "body"], ["F", "body-file"], ["H", "head"], ["l", "label"], ["m", "milestone"], ["p", "project"], ["r", "reviewer"], ["R", "repo"], ["T", "template"], ["t", "title"]]);
/** `--recover` is left out on purpose: it restores the inputs of a failed run from a file, which can name another head, so the gate refuses it. */
const TAKES_VALUE_LONG = new Set([...TAKES_VALUE.values(), "attach"]);
const SWITCHES = new Map([["d", "draft"], ["e", "editor"], ["f", "fill"], ["h", "help"], ["w", "web"]]);
const SWITCHES_LONG = new Set([...SWITCHES.values(), "dry-run", "fill-first", "fill-verbose", "no-maintainer-edit"]);

/**
 * The options gh would read from `words`, by long name, the way its flag parser reads them: `--name value`, `--name=value`,
 * `-x value`, `-xvalue`, `-x=value`, and groups such as `-dH value`. A word taken as a value is never read as an option.
 * Stops at the first word it cannot read as an option, since gh pr create takes no other words, and what follows an unknown option
 * could be its value or another option.
 */
function options(words: string[]): { found: [string, string | undefined][]; unknown?: string } {
  const found: [string, string | undefined][] = [];
  for (let at = 0; at < words.length; at++) {
    const word = words[at];
    if (!word.startsWith("-") || word === "-") return { found, unknown: word };
    if (word.startsWith("--")) {
      const [name, ...value] = word.slice(2).split("=");
      if (TAKES_VALUE_LONG.has(name)) found.push([name, value.length ? value.join("=") : words[++at]]);
      else if (SWITCHES_LONG.has(name)) found.push([name, undefined]);
      else return { found, unknown: word };
    } else {
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

/**
 * The options of a PR line the gate can judge, or why it cannot. The hook runs before the line, and the shell expands it after,
 * so the line must be exactly `gh pr create` and options whose words the shell leaves as they are, aimed at this folder's repository.
 */
function prOptions(raw: string): { args: string[] } | { why: string } {
  const words = staticWords(raw.trim());
  if (!words || words[0] !== "gh" || words[1] !== "pr" || words[2] !== "create") return { why: ONE_COMMAND };
  for (const name of ["GH_REPO", "GH_HOST"]) {
    if (process.env[name]) return { why: `${name} is set in the environment, so gh may open the PR somewhere other than this folder's repository. Unset ${name}, then open the PR again` };
  }
  const args = words.slice(3);
  const { found, unknown } = options(args);
  if (unknown) return { why: `coherence cannot read ${unknown === HEREDOC_TEXT ? "a substitution" : unknown} as an option of gh pr create, so it cannot tell which branch the PR names. ${ONE_COMMAND}` };
  if (found.some(([name, value]) => value === HEREDOC_TEXT && name !== "body")) return { why: `only --body may be a substitution. ${ONE_COMMAND}` };
  if (found.some(([name]) => name === "repo")) return { why: `--repo points gh at a repository the gate did not check. ${ONE_COMMAND}` };
  if (found.filter(([name]) => name === "head").length > 1) return { why: "the PR's head is named more than once. Name it once, with --head <branch>" };
  return { args };
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
