import { greetingConfig } from "./config.ts";
import { DefaultGreetingStrategy } from "./default-strategy.ts";
import type { GreetingStrategy } from "./strategy.ts";

export function createGreetingStrategy(): GreetingStrategy {
  return new DefaultGreetingStrategy(greetingConfig);
}
