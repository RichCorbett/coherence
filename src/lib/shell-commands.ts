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
 * What in a line can put words or code in front of a command that its parsed words do not show, or undefined when nothing can:
 * a substitution outside double quotes, whose output splits into new words, or a `name()` function definition, which can shadow any command.
 * The `function name` form needs no check here: its first word is `function`, which `shellCommands` already shows.
 * A heredoc body with a quoted delimiter is data. One without still expands, so a substitution in it counts.
 */
export function hiddenCode(line: string): string | undefined {
  let expanding = "";
  const text = line.replace(HEREDOC, (match: string, quote: string, _name: string, rest: string) => {
    if (!quote && match.includes("\n")) expanding += match.slice(match.indexOf("\n"));
    return rest;
  });
  if (/\$\(|`/.test(expanding)) return "a substitution in a heredoc whose delimiter is not quoted";

  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = undefined;
    } else if (char === "\\") {
      i++;
    } else if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (text.startsWith("$(", i)) i = closingParen(text, i + 1);
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "`" || text.startsWith("$(", i)) {
      return "a substitution outside double quotes";
    } else if (char === "(" && /[\w.:-]\s*$/.test(text.slice(0, i)) && /^\(\s*\)/.test(text.slice(i))) {
      return "a function definition";
    }
  }
  return undefined;
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
