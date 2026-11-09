import { PingCommand } from "./commands/ping.ts";
import { addBooking } from "./commands/book.ts";
import { listBookings } from "./commands/list.ts";
import { report } from "./commands/report.ts";
import { bookings } from "./lib/bookings.ts";

const ping = new PingCommand();

export function dispatch(line: string): string {
  const [name, ...args] = line.trim().split(/\s+/);
  switch (name) {
    case ping.name:
      return ping.run();
    case "list":
      return listBookings();
    case report.id:
      return report.handler();
    case "book":
      return addBooking(args);
    case "export":
      return JSON.stringify(structuredClone(bookings));
    default:
      return `unknown command: ${name}`;
  }
}
