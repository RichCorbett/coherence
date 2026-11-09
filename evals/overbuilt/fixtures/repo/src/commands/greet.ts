import { BaseCommand } from "../lib/base-command.ts";
import { createGreetingStrategy } from "../greeting/factory.ts";

export class GreetCommand extends BaseCommand {
  readonly name = "greet";

  execute(args: string[]): string {
    return createGreetingStrategy().greet(args[0] ?? "there");
  }
}
