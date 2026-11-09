import assert from "node:assert/strict";
import { test } from "node:test";
import { ArchitectureDocCheck } from "../../src/checks/architecture-doc.ts";
import { tempRepo } from "../helpers/temp-repo.ts";

test("reports a repo with no ARCHITECTURE.md at its root", async () => {
  const repo = await tempRepo({ "docs/ARCHITECTURE.md": "# nested\n" });
  const findings = await new ArchitectureDocCheck().run(repo);
  assert.deepEqual(findings.map((finding) => finding.path), ["ARCHITECTURE.md"]);
});

test("passes a repo that has one", async () => {
  const repo = await tempRepo({ "ARCHITECTURE.md": "# Architecture\n" });
  assert.deepEqual(await new ArchitectureDocCheck().run(repo), []);
});
