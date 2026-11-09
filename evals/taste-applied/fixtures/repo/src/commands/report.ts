import { BaseCommand } from "../lib/base-command.ts";
import { bookings } from "../lib/bookings.ts";

function shortDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class ReportCommand extends BaseCommand {
  readonly name = "report";

  execute(): string {
    return bookings.map((booking) => `${shortDate(booking.day)}: ${booking.people.length} people`).join("\n");
  }
}
