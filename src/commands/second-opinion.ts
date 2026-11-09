import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseCommand, Exit, openReviewTarget, type Invocation } from "../lib/base-command.ts";
import { runProcess, withTempFolder } from "../lib/process.ts";
import { readPluginFile } from "../lib/plugin-files.ts";
import { readTaste } from "../lib/taste.ts";

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
// Long enough for a whole-repo read, short enough that a stuck run cannot hold up a review for hours.
const REVIEW_TIME_LIMIT_MS = 30 * 60 * 1000;

/** Asks a reviewer from another vendor (Codex) the same question the readability reviewer answers, since its mistakes differ from Claude's. */
export class SecondOpinionCommand extends BaseCommand {
  readonly name = "second-opinion";
  readonly usage = "coherence second-opinion [--base <ref>]";

  async execute(invocation: Invocation): Promise<number> {
    const { repo, base } = await openReviewTarget(invocation);

    const reviewer = (await readPluginFile("agents/readability-reviewer.md")).replace(FRONTMATTER, "").trim();
    const scope = base ? `Review the diff against ${base}` : "Review the whole repository";
    const prompt = [reviewer, (await readTaste()).trim(), scope].join("\n\n");

    return withTempFolder(async (folder) => {
      const answerFile = join(folder, "last-message.md");
      const args = ["exec", "--sandbox", "read-only", "--ephemeral", "--cd", repo.root, "--output-last-message", answerFile, prompt];
      const result = await runProcess("codex", args, repo.root, REVIEW_TIME_LIMIT_MS).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!result) {
        invocation.print("coherence second-opinion: skipped, codex is not installed");
        return Exit.unavailable;
      }
      if (result.code !== 0) {
        invocation.printError(result.stderr.trimEnd());
        return Exit.failed;
      }
      invocation.print((await readFile(answerFile, "utf8")).trimEnd());
      return Exit.ok;
    });
  }
}
