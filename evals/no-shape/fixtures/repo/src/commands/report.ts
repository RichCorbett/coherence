import { bookings } from "../lib/bookings.ts";
import { formatDay } from "../lib/format.ts";
import { deskLoad } from "../ticket-142.ts";

export const report = {
  id: "report",
  handler: (): string => {
    const load = deskLoad(bookings);
    return bookings
      .map((booking) => `${formatDay(booking.day)}: ${booking.people.length} people (desk ${booking.desk} total ${load.get(booking.desk)})`)
      .join("\n");
  },
};
