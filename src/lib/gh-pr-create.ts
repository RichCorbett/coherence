import { basename } from "node:path";
import { HEREDOC_TEXT, staticWords } from "./shell-commands.ts";

/**
 * A word the shell could still change. A trailing `@`, `+` or `!` is an extended glob such as `@(pr)`, which the parser splits at `(`.
 * A `[` counts only with a `]` after it: measured 2026-11-12 with a file named gh present, bash leaves `[`, `[[` and `g[h` as they are
 * and zsh refuses `g[` as a bad pattern, so neither turns them into gh. Counting a lone `[` refused the test command, as in `[ -n "$P" ]`.
 * Found with indexOf rather than a regex, which backtracks quadratically on a long run of `[`.
 */
const COULD_EXPAND = (word: string) => /[$`*?{\\]|[@+!]$/.test(word) || (word.includes("[") && word.indexOf("]", word.indexOf("[")) !== -1);
/** A word that is `gh`, or that the shell could still turn into `gh` by expanding it. */
const COULD_BE_GH = (word: string) => basename(word) === "gh" || COULD_EXPAND(word);

/** Tokens of the raw line, wherever they sit: in quotes, heredoc bodies or substitutions. A hyphen or word character next to one makes it part of another word. */
const NAMES_PR_CREATE = /(?<![\w-])gh['"\s\\]+pr['"\s\\]+create(?![\w-])/;
const RUNS_TEXT = /(?<![\w-])(ba|z|da)?sh\s+-[a-z]*c(?![\w-])/;
const NAMES_GH_OR_PR = /(?<![\w-])(gh|pr)(?![\w-])/;

/** A literal word that is not an option, so it is what it reads as. */
const FIXED = (word?: string) => word !== undefined && !word.startsWith("-") && !COULD_EXPAND(word);

/**
 * Whether a line could open a PR, so that it must be exactly `gh pr create` or be refused. Broad on purpose, so it also matches a
 * mention, such as one in a commit message. The raw text matches when it names `gh pr create` anywhere, or names `gh` or `pr` on a
 * line that runs text as commands: through `sh -c` in the raw text, or through a parsed word that is `eval` or assigns it, as in
 * `x=eval`. `eval` counts only as a parsed word: matched in the raw text, it refused `gh issue close --comment "the eval passed"`
 * (#69). Quoted text naming gh is refused by shellCommands anyway, and text piped or fed to a shell is not seen with or without
 * `eval`. A parsed command matches when `pr` and then `create` follow a word that is or
 * could become `gh`, such as `g[h]`, or when it starts with `pr`, where a substitution split it from its executable. It also matches
 * a command with a word that is literally `gh`, wherever it sits, or a first word that could become `gh`, and an expandable word
 * after it, unless that gh's subcommand is fixed and is not `pr create`.
 *
 * Considered and rejected: finding the executable by skipping wrappers (`env`, `sudo`, `nice`) and their options. It needs a table
 * of which options take a value, and the table grew its own bypasses (`/usr/bin/env`, `sudo -Eu user`, `A+=x`). Looking at every
 * `gh` word needs no table. Considered and rejected: anchoring on an expandable word in any position, because `ls *.ts *.md` and
 * `cp $SRC $DST` would be refused; only the first word is anchored, which covers `"$GH" "$P" create` and `g[h] "$P" create`.
 * Accepted costs: an expandable executable behind a wrapper (`env $GH "$P" create`) and `$CMD` are not seen; `$EDITOR $FILE` is
 * refused, as is `printf '%s %s' gh "$HOME"`, which falls under "a mention of gh is refused". `eval` built from pieces and run by
 * `command` or `builtin` (`x=ev; command "${x}al" ...`) is not seen, as it was not when the raw text was matched; an `eval` word
 * that is only an argument (`gh issue close --comment eval`) is refused, since telling it apart needs the wrapper table.
 */
export function opensPr(raw: string, line: string[][]): boolean {
  const runsText = RUNS_TEXT.test(raw) || line.some((words) => words.some((word) => word === "eval" || word.endsWith("=eval")));
  if (NAMES_PR_CREATE.test(raw) || (runsText && NAMES_GH_OR_PR.test(raw))) return true;
  return line.some((words) => {
    // A gh with an expandable word after it is a candidate unless its subcommand is proven fixed and not `pr create`: an option or
    // an expansion where the subcommand belongs could hide `pr` or `create`, and prOptions then refuses it.
    let expandsLater = false;
    for (let at = words.length - 1; at >= 0; at--) {
      const anchor = basename(words[at]) === "gh" || (at === 0 && COULD_BE_GH(words[at]));
      if (anchor && expandsLater && !(FIXED(words[at + 1]) && (words[at + 1] !== "pr" || (FIXED(words[at + 2]) && words[at + 2] !== "create")))) return true;
      expandsLater ||= COULD_EXPAND(words[at]);
    }
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
export function options(words: string[]): { found: [string, string | undefined][]; unknown?: string } {
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
export function prOptions(raw: string): { args: string[] } | { why: string } {
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
export function hookInput(stdin: string): { command: string; cwd?: string } | undefined {
  try {
    const hook = JSON.parse(stdin);
    if (typeof hook?.tool_input?.command !== "string") return undefined;
    return { command: hook.tool_input.command, cwd: typeof hook.cwd === "string" && hook.cwd !== "" ? hook.cwd : undefined };
  } catch {
    return undefined;
  }
}
