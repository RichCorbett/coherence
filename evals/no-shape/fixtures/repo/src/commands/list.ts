import { bookings } from "../lib/bookings.ts";
import { formatDay } from "../lib/format.ts";

export function listBookings(): string {
  return bookings.map((booking) => `${booking.desk} ${formatDay(booking.day)}`).join("\n");
}
