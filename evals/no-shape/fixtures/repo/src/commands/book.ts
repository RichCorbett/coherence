import { ingestLine } from "../ingest.ts";
import { bookings } from "../lib/bookings.ts";

export function addBooking(args: string[]): string {
  const booking = ingestLine(args.join(" "));
  if (!booking) return "usage: book <desk> <day> <person>";
  bookings.push(booking);
  return `booked ${booking.desk}`;
}
