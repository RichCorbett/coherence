import { BaseCommand } from "../lib/base-command.ts";
import { bookings } from "../lib/bookings.ts";
import { formatDay } from "../lib/format.ts";

export class ListCommand extends BaseCommand {
  readonly name = "list";

  execute(): string {
    return bookings.map((booking) => `${booking.desk} ${formatDay(booking.day)}`).join("\n");
  }
}
