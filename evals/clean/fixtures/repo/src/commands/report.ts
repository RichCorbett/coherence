import { BaseCommand } from "../lib/base-command.ts";
import { bookings } from "../lib/bookings.ts";
import { formatDay } from "../lib/format.ts";

export class ReportCommand extends BaseCommand {
  readonly name = "report";

  execute(): string {
    return bookings.map((booking) => `${formatDay(booking.day)}: ${booking.people.length} people`).join("\n");
  }
}
