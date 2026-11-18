import { parseArgs } from "node:util";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { readPluginFile } from "../lib/plugin-files.ts";
import { Repo } from "../lib/repo.ts";
import { readSharedTaste, readTaste } from "../lib/taste.ts";

// A shorter quote, such as "one way", is found in almost any text, so it would vouch for nothing; a whole rule name is the exception.
const MIN_WORDS = 4;

/** Whitespace, markdown emphasis and the curly apostrophe the skill writes for a straight one differ without changing the words. */
function plain(text: string): string {
  return text.replace(/\*\*|__|`/g, "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

/** Each list item with its indented continuation lines, and each other line but headings, as one entry: a quote must come from one of them. */
function entries(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const continues = /^\s+\S/.test(line) && !/^\s*([-*+]|\d+\.)\s/.test(line) && found.length > 0;
    if (continues) found[found.length - 1] += ` ${line}`;
    else found.push(line);
  }
  return found.filter((line) => !line.startsWith("#")).map(plain).filter((entry) => entry !== "");
}

/** The bold name each list item opens with, such as "Few concepts": a quote of a whole name is found whatever its length, since it names one rule. */
function names(text: string): Set<string> {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    const name = /^\s*(?:[-*+]|\d+\.)\s+(\*\*|__)(.+?)\1/.exec(line)?.[2];
    if (name !== undefined) found.add(bare(plain(name)));
  }
  return found;
}

/** A rule name or quote without the full stop or colon that may end it. */
function bare(text: string): string {
  return text.replace(/[.:]$/, "");
}

/** Whether `quote` is in `entry` as whole words, so "ever write" does not pass for "never write". */
function holds(entry: string, quote: string): boolean {
  return new RegExp(`(?<!\\w)${quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`).test(entry);
}

/** Says, for each quote a reviewer finding gave as its rule, whether those words appear in the design rules or the owner's taste (#61). */
export class QuotesCommand extends BaseCommand {
  readonly name = "quotes";
  readonly usage =
    "coherence quotes [--base <ref>] [--] '<quoted rule>'...  (exits 1 when any quote is neither found word for word in the rules or taste nor a rule's whole bold name; with --base, the repo's shared taste at that ref counts too)";

  async execute(invocation: Invocation): Promise<number> {
    const { values, positionals } = parseArgs({ args: invocation.args, options: { base: { type: "string" } }, allowPositionals: true });
    if (positionals.length === 0) {
      invocation.printError(`usage: ${this.usage}`);
      return Exit.usage;
    }
    const repo = values.base === undefined ? undefined : await Repo.open(invocation.cwd);
    const shared = repo && values.base !== undefined ? await readSharedTaste(repo, await repo.resolveCommit(values.base)) : undefined;
    const text = `${await readPluginFile("rules/design.md")}\n${await readTaste(shared)}`;
    const standard = entries(text);
    const ruleNames = names(text);
    let missing = 0;
    for (const arg of positionals) {
      const quote = plain(arg).replace(/^["“]|["”]$/g, "");
      const found = ruleNames.has(bare(quote)) || (quote.split(" ").length >= MIN_WORDS && standard.some((entry) => holds(entry, quote)));
      if (!found) missing++;
      invocation.print(`${found ? "found" : "not found"}: ${quote}`);
    }
    return missing === 0 ? Exit.ok : Exit.findings;
  }
}
