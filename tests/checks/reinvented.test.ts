import assert from "node:assert/strict";
import { test } from "node:test";
import { ReinventedCheck } from "../../src/checks/reinvented.ts";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { fakeInvocation, tempRepo } from "../helpers/temp-repo.ts";

const FORMAT = `export function formatDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return \`\${year}-\${month}-\${day}\`;
}

export function totalPrice(items: { price: number; count: number }[]): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.count;
  }
  return Math.round(total * 100) / 100;
}
`;
// The same two helpers under other names, with one product's factors swapped: a text clone to no tool, but the same code.
const REPORT = `import { formatDay, totalPrice } from "../lib/format.ts";

export function shortDate(when: Date): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, "0");
  const d = String(when.getDate()).padStart(2, "0");
  return \`\${y}-\${m}-\${d}\`;
}

export function orderSum(lines: { price: number; count: number }[]): number {
  let sum = 0;
  for (const line of lines) {
    sum += line.count * line.price;
  }
  return Math.round(sum * 100) / 100;
}

export const used = [formatDay, totalPrice];
`;
const APP = {
  "package.json": JSON.stringify({ name: "app", main: "src/main.ts" }),
  "src/lib/format.ts": FORMAT,
  "src/commands/report.ts": REPORT,
  "src/main.ts": 'import { orderSum, shortDate, used } from "./commands/report.ts";\nconsole.log(orderSum, shortDate, used);\n',
};

async function report(files: Record<string, string>): Promise<string[]> {
  const findings = await new ReinventedCheck().run(await tempRepo(files));
  return findings.map((finding) => `${finding.path}:${finding.line} ${finding.tier} ${finding.message}`).sort();
}

test("helpers rewritten under other names are a note on each copy, naming the other", async () => {
  assert.deepEqual(await report(APP), [
    "src/commands/report.ts:3 note lines 3-15 do what src/lib/format.ts:1-13 already does under other names; reuse one",
    "src/lib/format.ts:1 note lines 1-13 do what src/commands/report.ts:3-15 already does under other names; reuse one",
  ]);
});

test("unrelated code is not reported, and a repo with no source files is not handed to fallow", async () => {
  assert.deepEqual(await report({ ...APP, "src/commands/report.ts": "export const used = 1;\n" }), []);
  assert.deepEqual(await report({ "notes.md": "hi\n" }), []);
});

test("the repo's fallow-ignore comments cannot hide a reinvented helper", async () => {
  const hidden = `// fallow-ignore-file\n${REPORT.replace("export function shortDate", "// fallow-ignore-next-line code-duplication\nexport function shortDate")}`;
  const findings = await report({ ...APP, "src/commands/report.ts": hidden });
  assert.equal(findings.length, 2, findings.join("\n"));
});

test("through check, a reinvented helper is a note and the branch stays clean", async () => {
  const invocation = fakeInvocation((await tempRepo(APP)).root);
  assert.equal(await new CheckCommand().execute(invocation), Exit.ok);
  assert.ok(invocation.printed.some((line) => line.startsWith("src/lib/format.ts:1 [reinvented] note: lines 1-13 do what")));
});

test("each finding names at most three of the others, so a large group stays one line per piece", async () => {
  const copies = Object.fromEntries(["a", "b", "c"].map((name) => [`src/commands/${name}.ts`, REPORT.replaceAll("shortDate", `${name}Date`).replaceAll("orderSum", `${name}Sum`)]));
  const findings = await report({ ...APP, ...copies });
  // The five copies form one group; fallow also groups the four command files on their own.
  for (const finding of findings) assert.ok((finding.split(" do what ")[1].match(/\.ts:/g) ?? []).length <= 3, finding);
  assert.equal(findings.filter((finding) => finding.includes(" and 1 more already does")).length, 5, findings.join("\n"));
});
