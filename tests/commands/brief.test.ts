import assert from "node:assert/strict";
import { test } from "node:test";
import { BriefCommand } from "../../src/commands/brief.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { isolatedPlugin } from "../helpers/sandbox.ts";
import { fakeInvocation, tempRepo } from "../helpers/temp-repo.ts";

const PLUGIN = { "rules/design.md": "# Rules\n\n- reuse what exists\n", "taste/style.md": "# Style\n\n- plain words\n" };

const REPO = {
  "src/commands/report.ts": "export async function report(): Promise<void> {}\n",
  "src/lib/format.ts": "export function formatDay(day: Date): string {\n  return day.toISOString();\n}\nexport const SEPARATOR = \" | \";\nfunction hidden() {}\n",
  "src/lib/bookings.ts": "export type Booking = { day: Date };\nexport interface Store {}\nexport class Bookings {}\n",
  "tools/gen.ts": "export function gen() {}\n",
  "src/far/away/deep.ts": "export function deep() {}\n",
};

async function brief(t: Parameters<typeof isolatedPlugin>[0], args: string[], files: Record<string, string> = REPO) {
  isolatedPlugin(t, PLUGIN);
  const repo = await tempRepo(files);
  const invocation = fakeInvocation(repo.root, args);
  return { exit: await new BriefCommand().execute(invocation), out: invocation.printed.join("\n"), errors: invocation.errors.join("\n") };
}

test("prints the rules, the taste and the exports in the named folder and its siblings", async (t) => {
  const { exit, out } = await brief(t, ["src/commands"]);
  assert.equal(exit, Exit.ok);
  assert.match(out, /=== DESIGN RULES ===\n# Rules\n\n- reuse what exists/);
  assert.match(out, /=== OWNER TASTE ===\n# Style/);
  assert.match(out, /src\/lib\/format\.ts: formatDay, SEPARATOR$/m);
  assert.match(out, /src\/lib\/bookings\.ts: Booking, Store, Bookings/);
  assert.match(out, /src\/commands\/report\.ts: report/);
  assert.doesNotMatch(out, /hidden|tools\/gen\.ts|deep/);
});

test("a named file briefs its folder", async (t) => {
  const { out } = await brief(t, ["src/lib/format.ts"]);
  assert.match(out, /src\/lib\/format\.ts: formatDay/);
  assert.match(out, /src\/commands\/report\.ts: report/);
});

test("a folder that does not exist yet still briefs its siblings", async (t) => {
  const { out } = await brief(t, ["src/new"]);
  assert.match(out, /src\/lib\/format\.ts: formatDay/);
});

test("past the cap it says how many it left out instead of printing them", async (t) => {
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, at) => [`src/lib/f${String(at).padStart(2, "0")}.ts`, Array.from({ length: 5 }, (_, n) => `export const v${at}_${n} = 1;\n`).join("")]));
  const { out } = await brief(t, ["src/lib"], many);
  assert.match(out, /\.\.\. and 50 more; name a narrower folder to see them/);
  assert.doesNotMatch(out, /v30_0/);
});

test("refuses a path outside the repo, and needs at least one path", async (t) => {
  for (const args of [["../elsewhere"], ["/etc"]]) {
    const { exit, errors } = await brief(t, args);
    assert.equal(exit, Exit.usage);
    assert.match(errors, /not a path inside the repo/);
  }
  assert.equal((await brief(t, [])).exit, Exit.usage);
});
