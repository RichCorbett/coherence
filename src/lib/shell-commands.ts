import { basename } from "node:path";

/** `<<` and its delimiter, which must be followed by something that ends the word, so a delimiter this cannot read is never trusted to end a body. */
const HEREDOC_OPEN = /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1(?![^\s;&|()<>])/y;

/**
 * Thrown for a substitution whose end this cannot find with confidence. Reading on past a guessed end could leave real commands
 * inside what the outer pass takes for quoted text, so shellCommands answers with UNREADABLE_COMMAND, which the PR gate refuses.
 */
const UNREADABLE = new Error("a substitution this cannot read");
const UNREADABLE_COMMAND = ["gh", "pr", "create"];

const CASE = /^case\s/;
const SHELL = /^(ba|z|da)?sh$/;
const RUNS_NEXT_WORD = /^-[a-z]*c$/;

/** Every command a shell line would run, as words, including those inside substitutions, `sh -c` and `eval`. */
export function shellCommands(line: string): string[][] {
  let parsed;
  try {
    parsed = parse(line);
  } catch (error) {
    if (error === UNREADABLE) return [UNREADABLE_COMMAND];
    throw error;
  }
  const { commands, substitutions } = parsed;
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

/** Splits at shell separators and honours quotes, so quoted text stays one word, and drops heredoc bodies. Substitutions inside double quotes still run, so they are collected. */
function parse(line: string): { commands: string[][]; substitutions: string[] } {
  const commands: string[][] = [];
  const substitutions: string[] = [];
  let words: string[] = [];
  let word: string | undefined;
  let quote: string | undefined;
  const bodies: string[] = [];

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
    } else if (heredocAt(line, i)) {
      // Only here, outside quotes, is `<<` a heredoc. Its body starts after this line and is data, so it is skipped, not parsed.
      const heredoc = heredocAt(line, i)!;
      bodies.push(heredoc.delimiter);
      i = heredoc.end - 1;
    } else if (/[;&|\n()`]/.test(char)) {
      if (char === "\n" && bodies.length) i = heredocBodyEnd(line, i, bodies.shift()!);
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

/** A backslash in a backtick substitution may escape a backtick, which this does not pair, so such a substitution is unreadable. */
function closingBacktick(line: string, open: number): number {
  const end = line.indexOf("`", open + 1);
  if (line.slice(open, end === -1 ? line.length : end).includes("\\")) throw UNREADABLE;
  return end === -1 ? line.length : end;
}

/** The delimiter of a heredoc opened at `at` and where its operator ends, or undefined when none opens there. `<<<` is a here-string. */
function heredocAt(line: string, at: number): { delimiter: string; end: number } | undefined {
  if (!line.startsWith("<<", at) || line[at - 1] === "<" || line[at + 2] === "<") return undefined;
  HEREDOC_OPEN.lastIndex = at;
  const open = HEREDOC_OPEN.exec(line);
  return open ? { delimiter: open[2], end: HEREDOC_OPEN.lastIndex } : undefined;
}

/** Where the body of a heredoc whose first line ends at `newline` ends: after its first line that is the delimiter, or the end of the line when there is none. */
function heredocBodyEnd(line: string, newline: number, delimiter: string): number {
  for (let start = newline + 1; start <= line.length; ) {
    const next = line.indexOf("\n", start);
    const end = next === -1 ? line.length : next;
    if (line.slice(start, end).replace(/^[ \t]+/, "") === delimiter) return end;
    if (next === -1) return line.length;
    start = next + 1;
  }
  return line.length;
}

/** Where the `)` that closes the substitution opened before `open` is. Quotes, escapes, comments and heredoc bodies hide parentheses, as in the shell. */
function closingParen(line: string, open: number): number {
  let depth = 0;
  const bodies: string[] = [];
  for (let i = open; i < line.length; i++) {
    const char = line[i];
    if (char === "\\") i++;
    else if (char === "'") i = closingQuote(line, i, "'");
    else if (char === '"') i = closingQuote(line, i, '"');
    else if (char === "#" && /[\s;&|()]/.test(line[i - 1] ?? " ")) i = line.indexOf("\n", i) === -1 ? line.length : line.indexOf("\n", i) - 1;
    else if (char === "\n" && bodies.length) i = heredocBodyEnd(line, i, bodies.shift()!);
    else if (heredocAt(line, i)) {
      const heredoc = heredocAt(line, i)!;
      bodies.push(heredoc.delimiter);
      i = heredoc.end - 1;
    } else if (char === "c" && CASE.test(line.slice(i, i + 5)) && /[\s;&|(]/.test(line[i - 1] ?? " ")) {
      // A `)` ends a case pattern, not the substitution, and pairing case with esac is not attempted.
      throw UNREADABLE;
    } else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return i;
  }
  return line.length;
}

/** Where the quote opened at `open` closes, or the end of the line. In double quotes a `$(` runs commands whose own quotes and parentheses nest. */
function closingQuote(line: string, open: number, quote: string): number {
  for (let i = open + 1; i < line.length; i++) {
    if (line[i] === quote) return i;
    if (quote === '"' && line[i] === "\\") i++;
    else if (quote === '"' && line.startsWith("$(", i)) i = closingParen(line, i + 1);
  }
  return line.length;
}
