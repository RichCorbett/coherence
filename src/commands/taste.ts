import { BaseCommand, type Invocation } from "../lib/base-command.ts";
import { appendTaste, readTaste, type Verdict } from "../lib/taste.ts";

const VERDICTS: string[] = ["accepted", "rejected"];

/** Shows the owner's taste, or records one more finding the owner accepted or rejected. */
export class TasteCommand extends BaseCommand {
  readonly name = "taste";
  readonly usage = 'coherence taste [accepted|rejected "<finding>"]';

  async execute(invocation: Invocation): Promise<number> {
    const [verb, ...words] = invocation.args;
    if (verb === undefined) {
      invocation.print((await readTaste()).trimEnd());
      return 0;
    }

    const finding = words.join(" ").trim();
    if (!VERDICTS.includes(verb) || finding === "") {
      invocation.print(`usage: ${this.usage}`);
      return 2;
    }
    await appendTaste(verb as Verdict, finding);
    return 0;
  }
}
