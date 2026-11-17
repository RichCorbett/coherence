import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { readPluginFile } from "../lib/plugin-files.ts";
import { readTaste } from "../lib/taste.ts";

// A shorter quote, such as "one way", is found in almost any text, so it would vouch for nothing.
const MIN_WORDS = 4;

/** Whitespace and markdown emphasis differ between a copy and its source without changing the words. */
function plain(text: string): string {
  return text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
}

/** Says, for each quote a reviewer finding gave as its rule, whether those words appear in the design rules or the owner's taste (#61). */
export class QuotesCommand extends BaseCommand {
  readonly name = "quotes";
  readonly usage = "coherence quotes '<quoted rule>'...  (exits 1 when any quote is not found word for word in the rules or taste)";

  async execute(invocation: Invocation): Promise<number> {
    if (invocation.args.length === 0) {
      invocation.printError(`usage: ${this.usage}`);
      return Exit.usage;
    }
    const standard = plain(`${await readPluginFile("rules/design.md")}\n${await readTaste()}`);
    let missing = 0;
    for (const arg of invocation.args) {
      const quote = plain(arg).replace(/^["“]|["”]$/g, "");
      const found = quote.split(" ").length >= MIN_WORDS && standard.includes(quote);
      if (!found) missing++;
      invocation.print(`${found ? "found" : "not found"}: ${quote}`);
    }
    return missing === 0 ? Exit.ok : Exit.findings;
  }
}
