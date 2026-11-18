import { parseArgs } from "node:util";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { readPluginFile } from "../lib/plugin-files.ts";
import { Repo } from "../lib/repo.ts";
import { readSharedTaste, readTaste, sharedTasteBase } from "../lib/taste.ts";

// A shorter quote, such as "one way", is found in almost any text, so it would vouch for nothing.
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

/** Whether `quote` is in `entry` as whole words, so "ever write" does not pass for "never write". */
function holds(entry: string, quote: string): boolean {
  return new RegExp(`(?<!\\w)${quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`).test(entry);
}

/** Says, for each quote a reviewer finding gave as its rule, whether those words appear in the design rules or the owner's taste (#61). */
export class QuotesCommand extends BaseCommand {
  readonly name = "quotes";
  readonly usage =
    "coherence quotes [--base <ref>] [--] '<quoted rule>'...  (exits 1 when any quote is not found word for word in the rules or taste; the repo's shared taste counts too, as committed at --base or else on origin's default branch)";

  async execute(invocation: Invocation): Promise<number> {
    const { values, positionals } = parseArgs({ args: invocation.args, options: { base: { type: "string" } }, allowPositionals: true });
    if (positionals.length === 0) {
      invocation.printError(`usage: ${this.usage}`);
      return Exit.usage;
    }
    // Outside a repo there is no shared taste to count, and with no --base it is read where a whole-repo review reads it.
    const repo = values.base === undefined ? await Repo.open(invocation.cwd).catch(() => undefined) : await Repo.open(invocation.cwd);
    const shared = repo && (await readSharedTaste(repo, await sharedTasteBase(repo, values.base)));
    const standard = entries(`${await readPluginFile("rules/design.md")}\n${await readTaste(shared)}`);
    let missing = 0;
    for (const arg of positionals) {
      const quote = plain(arg).replace(/^["“]|["”]$/g, "");
      const found = quote.split(" ").length >= MIN_WORDS && standard.some((entry) => holds(entry, quote));
      if (!found) missing++;
      invocation.print(`${found ? "found" : "not found"}: ${quote}`);
    }
    return missing === 0 ? Exit.ok : Exit.findings;
  }
}
