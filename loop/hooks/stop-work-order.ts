// Stop hook: while an approved work order still has open items, the agent may not end its turn. It is handed the next item instead.
// It lets the stop through when there is no approved work order for this folder, when every item is closed or parked, when gh cannot
// say which issues are closed, after stopsWithoutProgress stops in a row with nothing changed in the workdir, and after
// blocksPerSession blocks in one session. Each of those is a stop the owner should see, so none is worked around.
import { activeWorkOrder, DEFAULT_LIMITS, nextItem, parkedFile, progressMark, readHookInput, readState, writeState } from "../work-order.ts";

type StopInput = { session_id?: string; cwd?: string };
type Session = { item: number; mark: string; stops: number; blocks: number };

function decide(input: StopInput, now = Date.now()): { decision: "block"; reason: string } | undefined {
  const active = activeWorkOrder(input.cwd ?? process.cwd(), new Date(now));
  if (typeof active === "string") return undefined;
  let next;
  try {
    // A stop often comes right after the agent closed an issue, so the cache is skipped here.
    next = nextItem(active, now, true);
  } catch {
    return undefined;
  }
  if (next.item === undefined) return undefined;

  const { order, home } = active;
  const limits = { ...DEFAULT_LIMITS, ...order.limits };
  const sessions = readState<Record<string, Session>>(home, "stop", {});
  const key = `${order.id}:${input.session_id ?? "unknown"}`;
  const before = sessions[key];
  const mark = progressMark(order.workdir);
  const moved = before === undefined || before.item !== next.item.issue || before.mark !== mark;
  const session: Session = { item: next.item.issue, mark, stops: moved ? 0 : before.stops + 1, blocks: (before?.blocks ?? 0) + 1 };
  if (session.stops >= limits.stopsWithoutProgress || session.blocks > limits.blocksPerSession) {
    sessions[key] = { ...session, blocks: before?.blocks ?? 0 };
    writeState(home, "stop", sessions);
    return undefined;
  }
  sessions[key] = session;
  writeState(home, "stop", sessions);

  const item = next.item;
  const title = item.title ? ` (${item.title})` : "";
  const more = next.waiting > 0 ? ` ${next.waiting} more item(s) follow it.` : "";
  return {
    decision: "block",
    reason:
      `Work order ${order.id} is approved and still open. Next item: issue #${item.issue}${title}, on a branch named like ${item.branch}.${more} ` +
      `Without asking, this item may: ${item.ops.join(", ")}. The work order is Rich's approval for those steps, so do not ask him for a sentence per step. ` +
      `Decide anything inside the item yourself and write the choice in the commit message. ` +
      `A step outside the list goes to Rich with dcider-ask, and you carry on with work that does not depend on it. ` +
      `If this item cannot be finished, park it: append one JSON line {"issue": ${item.issue}, "why": "<reason>"} to ${parkedFile(order)}, then start the next item.`,
  };
}

if (import.meta.main) {
  const answer = decide(readHookInput<StopInput>());
  if (answer) console.log(JSON.stringify(answer));
}
