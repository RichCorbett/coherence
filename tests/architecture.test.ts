import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const SRC = resolve(import.meta.dirname, "../src");
const LAYERS = ["lib", "checks", "commands", "."];

function layerOf(file: string): string {
  const folder = relative(SRC, file).split("/")[0];
  return LAYERS.includes(folder) ? folder : ".";
}

test("each layer imports only the layers below it, and only lib may import its own layer", () => {
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".ts"));
  const violations: string[] = [];
  for (const path of files) {
    const file = join(SRC, path);
    const layer = layerOf(file);
    for (const [, target] of readFileSync(file, "utf8").matchAll(/from "(\.[^"]+)"/g)) {
      const imported = layerOf(resolve(dirname(file), target));
      const below = LAYERS.indexOf(imported) < LAYERS.indexOf(layer);
      const allowed = below || (layer === "lib" && imported === "lib");
      if (!allowed) violations.push(`${path} imports ${target}`);
    }
  }
  assert.deepEqual(violations, []);
});
