import { basename } from "node:path";

/** A heredoc's body is data, and the rest of its first line is still commands, so only the body goes. */
const HEREDOC = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1([^\n]*)(?:\n(?![ \t]*\2(?:\n|$))[^\n]*)*(?:\n[ \t]*\2(?=\n|$))?/g;

const SHELL = /^(ba|z|da)?sh$/;
const RUNS_NEXT_WORD = /^-[a-z]*c$/;

/** Every command a shell line would run, as words, including those inside substitutions, `sh -c` and `eval`. */
export function shellCommands(line: string): string[][] {
  const { commands, substitutions } = parse(line.replace(HEREDOC, "$3"));
  return [...commands, ...substitutions.flatMap(shellCommands), ...commands.flatMap(wrapped)];
}

/**
 * Stands for a word that was a double-quoted `$(cat <<'END' ... END)`: text that runs nothing, and whose content is not read.
 * Refusing this substitution too was considered, because the shell runs `cat` after the gate has judged the line, and a `cat`
 * overridden by a function or PATH could run anything. Rejected because overriding `cat` needs a function or PATH set earlier in
 * the session, the class the gate already does not cover, while refusing it would refuse Claude Code's standard way to open a PR.
 */
export const HEREDOC_TEXT = "\0heredoc text";

/** Unquoted characters the shell leaves as they are. Anything else separates, redirects, expands or globs. */
const PLAIN = /[\w\-./:=@,+%]/;
const QUOTED_HEREDOC = /"\$\(\s*cat\s*<<\s*(['"])([A-Za-z_]\w*)\1[ \t]*\n/y;
const CLOSES_SUBSTITUTION = /\s*\)"/y;

/**
 * The words of a line that is one simple command the shell runs as written, or undefined when it is anything more: another command,
 * a redirect, a variable, a substitution, a wildcard, or a character this does not know. Words may be plain, single-quoted, or
 * double-quoted with no `$` or backtick. The one exception is a word that is exactly a double-quoted `$(cat <<'END' ... END)` with a
 * quoted delimiter, so the body expands nothing; it comes back as HEREDOC_TEXT.
 */
export function staticWords(line: string): string[] | undefined {
  const words: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === " " || line[i] === "\t") {
      i++;
      continue;
    }
    let word = "";
    const heredoc = quotedHeredoc(line, i);
    if (heredoc !== -1) {
      word = HEREDOC_TEXT;
      i = heredoc;
    }
    while (word !== HEREDOC_TEXT && i < line.length && line[i] !== " " && line[i] !== "\t") {
      const char = line[i];
      if (PLAIN.test(char)) {
        word += char;
        i++;
      } else if (char === "'") {
        const end = line.indexOf("'", i + 1);
        if (end === -1) return undefined;
        word += line.slice(i + 1, end);
        i = end + 1;
      } else if (char === '"') {
        for (i++; line[i] !== '"'; ) {
          if (i >= line.length || line[i] === "$" || line[i] === "`") return undefined;
          if (line[i] === "\\" && line[i + 1] === "\n") {
            i += 2;
            continue;
          }
          if (line[i] === "\\" && /[$`"\\]/.test(line[i + 1] ?? "")) i++;
          word += line[i++];
        }
        i++;
      } else {
        return undefined;
      }
    }
    if (i < line.length && line[i] !== " " && line[i] !== "\t") return undefined;
    words.push(word);
  }
  return words;
}

/** Where a double-quoted `$(cat <<'END' ... END)` starting at `at` ends, or -1 when none starts there. The heredoc ends at its first line that is exactly the delimiter, as the shell ends it, and only `)"` may follow. */
function quotedHeredoc(line: string, at: number): number {
  QUOTED_HEREDOC.lastIndex = at;
  const open = QUOTED_HEREDOC.exec(line);
  if (!open) return -1;
  for (let start = QUOTED_HEREDOC.lastIndex; start <= line.length; ) {
    const newline = line.indexOf("\n", start);
    const end = newline === -1 ? line.length : newline;
    if (line.slice(start, end) === open[2]) {
      CLOSES_SUBSTITUTION.lastIndex = end;
      return CLOSES_SUBSTITUTION.exec(line) ? CLOSES_SUBSTITUTION.lastIndex : -1;
    }
    if (newline === -1) return -1;
    start = newline + 1;
  }
  return -1;
}

function wrapped(words: string[]): string[][] {
  const shell = words.findIndex((word) => SHELL.test(basename(word)));
  if (shell !== -1 && RUNS_NEXT_WORD.test(words[shell + 1] ?? "")) return shellCommands(words[shell + 2] ?? "");
  const evaluated = words.indexOf("eval");
  return evaluated === -1 ? [] : shellCommands(words.slice(evaluated + 1).join(" "));
}

/** Splits at shell separators and honours quotes, so quoted text stays one word. Substitutions inside double quotes still run, so they are collected. */
function parse(line: string): { commands: string[][]; substitutions: string[] } {
  const commands: string[][] = [];
  const substitutions: string[] = [];
  let words: string[] = [];
  let word: string | undefined;
  let quote: string | undefined;

  const endWord = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === "\\") word += line[++i] ?? "";
      else if (line.startsWith("$(", i) || char === "`") {
        const end = char === "`" ? closingBacktick(line, i) : closingParen(line, i + 1);
        substitutions.push(line.slice(i + (char === "`" ? 1 : 2), end));
        i = end;
      } else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= "";
    } else if (char === "\\") {
      word = (word ?? "") + (line[++i] ?? "");
    } else if (/[;&|\n()`]/.test(char)) {
      endCommand();
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word = (word ?? "") + char;
    }
  }
  endCommand();
  return { commands, substitutions };
}

function closingBacktick(line: string, open: number): number {
  const end = line.indexOf("`", open + 1);
  return end === -1 ? line.length : end;
}

function closingParen(line: string, open: number): number {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "(") depth++;
    if (line[i] === ")" && --depth === 0) return i;
  }
  return line.length;
}
