import assert from "node:assert/strict";
import { test } from "node:test";
import { asksRich, readTurn } from "../hooks/stop-route-questions.ts";
import { setupLoop, transcript } from "./helpers.ts";

const HOOK = "stop-route-questions.ts";

test("asks Rich: approval sentences, should-I questions and a closing question mark", () => {
  assert.ok(asksRich("If you agree, send this line: **Build feature #59 then merge and push it to main**"));
  assert.ok(asksRich("Tests pass. Should I merge it into main?"));
  assert.ok(asksRich("I can do A or B. Let me know which you prefer."));
  assert.ok(asksRich("Two options.\n\nWhich one do you want?"));
  assert.ok(asksRich("Waiting for your approval before I push."));
});

test("does not ask Rich: a plain report, or a question only inside code", () => {
  assert.equal(asksRich("Merged #66 into main, pushed, and closed the issue. Starting #67."), false);
  assert.equal(asksRich("The test now covers this:\n```ts\nconst ok = ready ? 'yes' : 'no?';\n```\nAll 180 pass."), false);
  assert.equal(asksRich("Fixed the `isReady?` helper and pushed."), false);
  assert.equal(asksRich(""), false);
});

test("a working turn that ends on a question is sent back once to use dcider-ask", (t) => {
  const loop = setupLoop(t);
  const path = transcript(loop.home, { command: "npm test" }, { text: "All green. Should I merge feat/66-guard into main?" });
  const answer = loop.run(HOOK, { session_id: "s1", transcript_path: path, stop_hook_active: false });
  assert.equal(answer?.decision, "block");
  assert.match(answer?.reason, /dcider-ask/);
  assert.match(answer?.reason, /keep working on everything that does not depend on it/);
  // Same turn, second stop: it goes through, so the hook can never loop.
  assert.equal(loop.run(HOOK, { session_id: "s1", transcript_path: path, stop_hook_active: true }), undefined);
});

test("last_assistant_message is read when Claude Code sends it", (t) => {
  const loop = setupLoop(t);
  const path = transcript(loop.home, { command: "npm test" }, { text: "Done." });
  assert.equal(loop.run(HOOK, { session_id: "s1", transcript_path: path, last_assistant_message: "Done." }), undefined);
  assert.equal(loop.run(HOOK, { session_id: "s1", prompt_id: "p2", transcript_path: path, last_assistant_message: "Want me to push it?" })?.decision, "block");
});

test("the stop goes through when the question was already filed with dcider-ask this turn", (t) => {
  const loop = setupLoop(t);
  const path = transcript(loop.home, { command: 'dcider-ask "Install the coherence plugin 0.1.19? Recommended: yes"' }, { text: "Filed the install request. Should I wait?" });
  assert.equal(loop.run(HOOK, { session_id: "s1", transcript_path: path }), undefined);
});

test("a conversation turn with no tools is left alone, even when it asks", (t) => {
  const loop = setupLoop(t);
  const path = transcript(loop.home, { text: "Here are the three options. Which one do you want?" });
  assert.equal(loop.run(HOOK, { session_id: "s1", transcript_path: path }), undefined);
});

test("a turn starts at the last prompt, not at a tool result", (t) => {
  const loop = setupLoop(t);
  const path = transcript(loop.home, { command: "git status" }, { text: "Clean." });
  const turn = readTurn(path);
  assert.equal(turn.key, "prompt-1");
  assert.equal(turn.usedTools, true);
  assert.equal(turn.text, "Clean.");
});
