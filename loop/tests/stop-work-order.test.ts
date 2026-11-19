import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parkedFile } from "../work-order.ts";
import { setupLoop } from "./helpers.ts";

const HOOK = "stop-work-order.ts";

test("with open items the stop is blocked and the next item is handed over with its steps", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({});
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  const answer = loop.run(HOOK, { session_id: "s1", cwd: loop.workdir, stop_hook_active: false });
  assert.equal(answer?.decision, "block");
  assert.match(answer?.reason, /Next item: issue #66/);
  assert.match(answer?.reason, /merge_main, push_main, close_issue, eval/);
  assert.match(answer?.reason, /do not ask him for a sentence per step/);
  assert.match(answer?.reason, /work-order-parked\.jsonl/);
});

test("once an item closes, the next stop hands over the one after it, reading GitHub fresh", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({});
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  loop.run(HOOK, { session_id: "s1", cwd: loop.workdir });
  loop.setStates({ 66: "closed", 67: "open", 58: "open" });
  assert.match(loop.run(HOOK, { session_id: "s1", cwd: loop.workdir })?.reason, /Next item: issue #67/);
});

test("the stop goes through when every item is closed or parked", (t) => {
  const loop = setupLoop(t);
  const order = loop.writeOrder({});
  loop.setStates({ 66: "closed", 67: "closed", 58: "open" });
  writeFileSync(parkedFile(order), JSON.stringify({ issue: 58, why: "issue says not now" }) + "\n");
  assert.equal(loop.run(HOOK, { session_id: "s1", cwd: loop.workdir }), undefined);
});

test("the stop goes through with no approved work order, outside the workdir, or when gh fails", (t) => {
  const loop = setupLoop(t);
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  assert.equal(loop.run(HOOK, { session_id: "s1", cwd: loop.workdir }), undefined);
  loop.writeOrder({}, false);
  assert.equal(loop.run(HOOK, { session_id: "s1", cwd: loop.workdir }), undefined);
  loop.writeOrder({});
  assert.equal(loop.run(HOOK, { session_id: "s1", cwd: loop.home }), undefined);
  loop.setStates({ fail: true });
  assert.equal(loop.run(HOOK, { session_id: "s1", cwd: loop.workdir }), undefined);
});

test("after stopsWithoutProgress stops with nothing changed, the stop goes through; a commit resets the count", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({ limits: { stopsWithoutProgress: 2 } });
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  const stop = () => loop.run(HOOK, { session_id: "s1", cwd: loop.workdir, stop_hook_active: true })?.decision;
  assert.equal(stop(), "block");
  assert.equal(stop(), "block");
  assert.equal(stop(), undefined);
  loop.git("commit", "-q", "--allow-empty", "-m", "progress");
  assert.equal(stop(), "block");
});

test("an uncommitted edit counts as progress", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({ limits: { stopsWithoutProgress: 1 } });
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  const stop = () => loop.run(HOOK, { session_id: "s1", cwd: loop.workdir })?.decision;
  assert.equal(stop(), "block");
  writeFileSync(join(loop.workdir, "draft.ts"), "export {};\n");
  assert.equal(stop(), "block");
  assert.equal(stop(), undefined);
});

test("one session is blocked at most blocksPerSession times; another session starts its own count", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({ limits: { blocksPerSession: 2, stopsWithoutProgress: 99 } });
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  const stop = (session: string) => loop.run(HOOK, { session_id: session, cwd: loop.workdir })?.decision;
  assert.equal(stop("s1"), "block");
  assert.equal(stop("s1"), "block");
  assert.equal(stop("s1"), undefined);
  assert.equal(stop("s2"), "block");
});
