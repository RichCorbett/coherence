import { BaseCommand } from "../lib/base-command.ts";
import { bookings } from "../lib/bookings.ts";

export class ExportCommand extends BaseCommand {
  readonly name = "export";

  execute(): string {
    return JSON.stringify(bookings);
  }
}
