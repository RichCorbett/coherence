import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BaseCommand, type Invocation } from "../lib/base-command.ts";
import { runProcess } from "../lib/process.ts";
import { Repo } from "../lib/repo.ts";
import { readPluginFile, readTaste } from "../lib/taste.ts";

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;

/** Asks a reviewer from another vendor (Codex) the same question the readability reviewer answers, since its mistakes differ from Claude's. */
export class SecondOpinionCommand extends BaseCommand {
  readonly name = "second-opinion";
  readonly usage = "coherence second-opinion [--base <ref>]";

  async execute(invocation: Invocation): Promise<number> {
    const { values } = parseArgs({ args: invocation.args, options: { base: { type: "string" } } });
    const repo = await Repo.open(invocation.cwd);

    const reviewer = (await readPluginFile("agents/readability-reviewer.md")).replace(FRONTMATTER, "").trim();
    const scope = values.base ? `Review the diff against ${values.base}` : "Review the whole repository";
    const prompt = [reviewer, (await readTaste()).trim(), scope].join("\n\n");

    const folder = await mkdtemp(join(tmpdir(), "coherence-codex-"));
    const answerFile = join(folder, "last-message.md");
    try {
      const args = ["exec", "--sandbox", "read-only", "--ephemeral", "--cd", repo.root, "--output-last-message", answerFile, prompt];
      const result = await runProcess("codex", args, repo.root).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!result) {
        invocation.print("coherence second-opinion: skipped, codex is not installed");
        return 3;
      }
      if (result.code !== 0) {
        invocation.print(result.stderr.trimEnd());
        return 1;
      }
      invocation.print((await readFile(answerFile, "utf8")).trimEnd());
      return 0;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
}
