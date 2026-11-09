import type { GreetingStrategy } from "./strategy.ts";
import type { GreetingOptions } from "./options.ts";

export class DefaultGreetingStrategy implements GreetingStrategy {
  constructor(private readonly options: GreetingOptions) {}

  greet(name: string): string {
    return `${this.options.salutation} ${name}`;
  }
}
