import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

/** Sets environment variables for one test and puts them back afterwards. */
export function setEnv(t: TestContext, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
  }
}

export function tempFolder(): string {
  return mkdtempSync(join(tmpdir(), "coherence-test-"));
}
