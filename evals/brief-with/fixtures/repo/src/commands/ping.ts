import { BaseCommand } from "../lib/base-command.ts";

export class PingCommand extends BaseCommand {
  readonly name = "ping";

  execute(): string {
    return "pong";
  }
}
