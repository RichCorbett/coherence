export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
