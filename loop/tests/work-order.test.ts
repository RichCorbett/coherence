import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { activeWorkOrder, nextItem, parkedFile } from "../work-order.ts";
import { setupLoop } from "./helpers.ts";

test("no work order, an unapproved one, or one edited after approval is not active", (t) => {
  const loop = setupLoop(t);
  assert.equal(activeWorkOrder(loop.workdir), "there is no work order");
  loop.writeOrder({}, false);
  assert.equal(activeWorkOrder(loop.workdir), "the work order is not approved");
  const order = loop.writeOrder({});
  writeFileSync(join(loop.home, "work-order.json"), JSON.stringify({ ...order, limits: { blocksPerSession: 999 } }));
  assert.equal(activeWorkOrder(loop.workdir), "the work order changed after it was approved");
});

test("an expired work order, or a folder outside its workdir, is not active", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({ expires: new Date(Date.now() - 1000).toISOString() });
  assert.equal(activeWorkOrder(loop.workdir), "the work order has expired");
  loop.writeOrder({});
  assert.equal(activeWorkOrder(loop.home), "this folder is outside the work order's workdir");
  assert.equal(typeof activeWorkOrder(join(loop.workdir)), "object");
});

test("a work order with an unknown step is refused as unreadable", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({ items: [{ issue: 66, branch: "feat/66-*", ops: ["force_push" as never] }] });
  assert.match(String(activeWorkOrder(loop.workdir)), /ops must be from/);
});

test("the next item skips closed and parked items and waits for its after issues", (t) => {
  const loop = setupLoop(t);
  const order = loop.writeOrder({});
  const active = activeWorkOrder(loop.workdir);
  assert.ok(typeof active === "object");
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  assert.equal(nextItem(active, Date.now(), true).item?.issue, 66);
  loop.setStates({ 66: "closed", 67: "open", 58: "open" });
  assert.equal(nextItem(active, Date.now(), true).item?.issue, 67);
  writeFileSync(parkedFile(order), JSON.stringify({ issue: 67, why: "needs a trust list design" }) + "\n");
  assert.equal(nextItem(active, Date.now(), true).item?.issue, 58);
  loop.setStates({ 66: "open", 67: "open", 58: "closed" });
  // #67 is parked and #58 closed, so only #66 is left.
  assert.equal(nextItem(active, Date.now(), true).item?.issue, 66);
});

test("issue states are cached for a minute unless asked fresh", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({});
  const active = activeWorkOrder(loop.workdir);
  assert.ok(typeof active === "object");
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  nextItem(active);
  nextItem(active);
  assert.equal(loop.calls().length, 3);
  nextItem(active, Date.now(), true);
  assert.equal(loop.calls().length, 6);
});
