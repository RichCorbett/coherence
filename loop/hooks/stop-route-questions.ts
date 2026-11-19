// Stop hook: when the agent ends a working turn by asking Rich something in chat ("should I...?", "send this line: ..."), it is sent
// back once to file the question with dcider-ask and keep working on whatever does not depend on the answer.
// It lets the stop through when the turn used no tools (a conversation, not work), when the agent already ran dcider-ask this turn,
// when it already sent the agent back once this turn, and when the final message asks nothing.
import { readFileSync } from "node:fs";
import { loopHome, readHookInput, readState, writeState } from "../work-order.ts";

type StopInput = { session_id?: string; prompt_id?: string; transcript_path?: string; last_assistant_message?: string };

/** Phrases that hand a decision or an approval back to Rich. Matched on prose only: code blocks and inline code are removed first. */
const ASKS = [
  /\bsend (me )?(this|that|the following|one) (line|sentence|message)\b/i,
  /\b(reply|answer|respond) with\b/i,
  /\bpaste (it |this |that )?back\b/i,
  /\b(should I|shall I|do you want( me)? to|would you like( me)? to|want me to|can you confirm|please confirm|your call)\b/i,
  /\blet me know (if|whether|which|how|what)\b/i,
  /\bwhich (option|one|approach|of these)\b[^.?!]*\?/i,
  /\b(waiting|wait) for (your|Rich's) (approval|answer|go-ahead|sentence)\b/i,
];

function prose(text: string): string {
  return text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

/** Whether the final message asks Rich for a decision or an approval. */
export function asksRich(text: string): boolean {
  const plain = prose(text).trim();
  if (plain === "") return false;
  const lastParagraph = plain.split(/\n\s*\n/).pop() ?? "";
  return ASKS.some((pattern) => pattern.test(plain)) || /\?\s*\**\s*$/.test(lastParagraph);
}

type Turn = { text: string; usedTools: boolean; filed: boolean; key: string };

type Entry = { type?: string; uuid?: string; message?: { content?: unknown } };
type Block = { type?: string; text?: string; name?: string; input?: { command?: unknown } };

/**
 * This turn read back from the transcript: its final text, whether it used tools, and whether one was a dcider-ask. The transcript
 * format is not documented, so anything unreadable counts as a working turn with nothing filed, which at worst sends the agent back once.
 */
export function readTurn(path: string | undefined): Turn {
  const unknown: Turn = { text: "", usedTools: true, filed: false, key: "unknown" };
  if (!path) return unknown;
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return unknown;
  }
  const entries: Entry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      // A partly written last line is skipped.
    }
  }
  const blocks = (entry: Entry): Block[] => (Array.isArray(entry.message?.content) ? (entry.message.content as Block[]) : []);
  const isPrompt = (entry: Entry) =>
    entry.type === "user" && (typeof entry.message?.content === "string" || blocks(entry).some((block) => block.type === "text"));
  let start = entries.length - 1;
  while (start >= 0 && !isPrompt(entries[start])) start--;
  const turn: Turn = { text: "", usedTools: false, filed: false, key: entries[start]?.uuid ?? `line-${start}` };
  for (const entry of entries.slice(start + 1)) {
    if (entry.type !== "assistant") continue;
    for (const block of blocks(entry)) {
      if (block.type === "text" && block.text) turn.text = block.text;
      if (block.type === "tool_use") {
        turn.usedTools = true;
        if (/\bdcider-ask\b/.test(String(block.input?.command ?? ""))) turn.filed = true;
      }
    }
  }
  return turn;
}

function decide(input: StopInput): { decision: "block"; reason: string } | undefined {
  const turn = readTurn(input.transcript_path);
  const text = input.last_assistant_message ?? turn.text;
  if (!turn.usedTools || turn.filed || !asksRich(text)) return undefined;

  const home = loopHome();
  const sent = readState<Record<string, string>>(home, "route", {});
  const session = input.session_id ?? "unknown";
  const key = input.prompt_id ?? turn.key;
  if (sent[session] === key) return undefined;
  sent[session] = key;
  writeState(home, "route", sent);

  return {
    decision: "block",
    reason:
      "Your last message asks Rich for a decision or an approval in chat, and he may not see it for hours. " +
      "If your own judgment can settle it, decide, say the assumption in one line, and carry on. " +
      "If it truly needs Rich, file it instead: run dcider-ask with the question and your recommended answer, then keep working on everything that does not depend on it. " +
      "If an approved work order already lists this step, it is approved: do it. " +
      "End your turn only when nothing independent of the answer is left.",
  };
}

if (import.meta.main) {
  const answer = decide(readHookInput<StopInput>());
  if (answer) console.log(JSON.stringify(answer));
}
