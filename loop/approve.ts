// Rich runs this in his own terminal, after reading the work order: node loop/approve.ts
// It checks the work order, prints what it allows, and records its hash as approved. Any later edit to the file voids the approval,
// and the hooks go quiet until he approves again. The PreToolUse hook refuses Bash lines that name this script.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loopHome, parseWorkOrder, sha256 } from "./work-order.ts";

const home = loopHome();
const file = join(home, "work-order.json");
if (!existsSync(file)) {
  console.error(`No work order at ${file}. Copy loop/work-order.example.json there and edit it first.`);
  process.exit(1);
}
const raw = readFileSync(file);
const order = parseWorkOrder(raw.toString("utf8"));
console.log(`Work order ${order.id} for ${order.repo}, base ${order.base}, workdir ${order.workdir}, expires ${order.expires}`);
for (const item of order.items) {
  const after = item.after?.length ? ` after #${item.after.join(", #")}` : "";
  console.log(`  #${item.issue}${after} on ${item.branch}: ${item.ops.join(", ")}${item.ops.includes("eval") ? ` (eval: ${item.evalCalls ?? 1} call(s) of up to ${item.evalRunsPerCall ?? 1} run(s))` : ""}`);
}
writeFileSync(join(home, "approval.json"), JSON.stringify({ id: order.id, sha256: sha256(raw), approvedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`Approved. To withdraw it, delete ${join(home, "approval.json")}.`);
