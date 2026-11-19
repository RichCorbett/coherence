import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TestContext } from "node:test";
import { git } from "../../tests/helpers/temp-repo.ts";
import { sha256, type WorkOrder } from "../work-order.ts";

const HOOKS = resolve(import.meta.dirname, "../hooks");

/** A fake gh that answers `gh api repos/<repo>/issues/<n> --jq .state` from a JSON file of issue states, and logs each call. */
const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const file = process.env.FAKE_GH_STATES;
const states = JSON.parse(fs.readFileSync(file, "utf8"));
const issue = (process.argv[3] || "").split("/").pop();
fs.appendFileSync(file + ".calls", issue + "\\n");
if (states.fail || !(issue in states)) process.exit(1);
process.stdout.write(states[issue] + "\\n");
`;

export type Loop = {
  home: string;
  workdir: string;
  env: NodeJS.ProcessEnv;
  setStates(states: Record<string, string | boolean>): void;
  calls(): string[];
  writeOrder(order: Partial<WorkOrder>, approve?: boolean): WorkOrder;
  run(hook: string, input: object): Record<string, any> | undefined;
  git(...args: string[]): string;
};

/** A loop home, a workdir that is a git repo on main with Rich's fork as origin, and a fake gh, all for one test. */
export function setupLoop(t: TestContext): Loop {
  const root = mkdtempSync(join(tmpdir(), "cl-test-"));
  const home = join(root, "home");
  const workdir = join(root, "work");
  const bin = join(root, "bin");
  for (const folder of [home, workdir, bin]) mkdirSync(folder, { recursive: true });
  git(workdir, "init", "-q", "-b", "main");
  git(workdir, "commit", "-q", "--allow-empty", "-m", "start");
  git(workdir, "remote", "add", "origin", "https://github.com/RichCorbett/coherence.git");
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  const statesFile = join(root, "states.json");
  writeFileSync(statesFile, "{}");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COHERENCE_LOOP_HOME: home, FAKE_GH_STATES: statesFile };
  const saved = { PATH: process.env.PATH, COHERENCE_LOOP_HOME: process.env.COHERENCE_LOOP_HOME, FAKE_GH_STATES: process.env.FAKE_GH_STATES };
  Object.assign(process.env, { PATH: env.PATH, COHERENCE_LOOP_HOME: home, FAKE_GH_STATES: statesFile });
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return {
    home,
    workdir,
    env,
    setStates: (states) => writeFileSync(statesFile, JSON.stringify(states)),
    calls: () => {
      try {
        return readFileSync(`${statesFile}.calls`, "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    writeOrder(partial, approve = true) {
      const order: WorkOrder = {
        id: "WO-TEST-1",
        repo: "RichCorbett/coherence",
        workdir,
        base: "main",
        expires: new Date(Date.now() + 86_400_000).toISOString(),
        items: [
          { issue: 66, branch: "feat/66-*", ops: ["merge_main", "push_main", "close_issue", "eval"], evalRunsPerCall: 1, evalCalls: 2 },
          { issue: 67, branch: "feat/67-*", ops: ["merge_main", "push_main", "close_issue"], after: [66] },
          { issue: 58, branch: "feat/58-*", ops: ["merge_main", "push_main", "close_issue"] },
        ],
        ...partial,
      };
      const raw = JSON.stringify(order, null, 2);
      writeFileSync(join(home, "work-order.json"), raw);
      if (approve) writeFileSync(join(home, "approval.json"), JSON.stringify({ id: order.id, sha256: sha256(raw) }));
      return order;
    },
    run(hook, input) {
      const result = spawnSync("node", [join(HOOKS, hook)], { input: JSON.stringify(input), env, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`${hook} exited ${result.status}: ${result.stderr}`);
      return result.stdout.trim() === "" ? undefined : JSON.parse(result.stdout);
    },
    git: (...args) => git(workdir, ...args),
  };
}

/** A transcript in the JSONL shape Claude Code writes: a prompt, then assistant entries holding text and tool_use blocks. */
export function transcript(root: string, ...assistant: Array<{ text?: string; command?: string }>): string {
  const file = join(root, `transcript-${Math.random().toString(36).slice(2)}.jsonl`);
  const lines = [{ type: "user", uuid: "prompt-1", message: { role: "user", content: "Build the next feature" } }];
  for (const [at, entry] of assistant.entries()) {
    const content = entry.text ? [{ type: "text", text: entry.text }] : [{ type: "tool_use", id: `tool-${at}`, name: "Bash", input: { command: entry.command } }];
    lines.push({ type: "assistant", uuid: `a-${at}`, message: { role: "assistant", content } } as never);
    if (entry.command) lines.push({ type: "user", uuid: `r-${at}`, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tool-${at}`, content: "ok" }] } } as never);
  }
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}
