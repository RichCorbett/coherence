import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const EVALS = join(import.meta.dirname, "..", "evals");

// The graders `stated-the-idea` and `kept-the-good-shape` look for the shape "each command extends BaseCommand, one file
// each, dispatched by name". If a fixture's own docs say it, the grader passes by quoting the doc and measures reading,
// not judging. So the docs may describe the layers but never the shape; the reviewer has to see it in the code.
const HANDS_OVER_THE_SHAPE = /BaseCommand|dispatch|by name|one file|one command/i;

function fixtureDocs(): string[] {
  const docs: string[] = [];
  for (const name of readdirSync(EVALS)) {
    const fixture = join(EVALS, name, "fixtures", "repo");
    if (existsSync(fixture)) docs.push(...readdirSync(fixture).filter((file) => file.endsWith(".md")).map((file) => join(fixture, file)));
  }
  return docs;
}

test("the docs scan reaches every fixture's README and ARCHITECTURE", () => {
  assert.equal(fixtureDocs().length, 10);
});

test("eval fixture docs do not hand the reviewer the shape the graders look for", () => {
  for (const doc of fixtureDocs()) assert.doesNotMatch(readFileSync(doc, "utf8"), HANDS_OVER_THE_SHAPE, doc);
});
