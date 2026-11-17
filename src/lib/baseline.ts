import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Finding } from "./base-check.ts";
import { ownerFile } from "./owner-state.ts";
import type { Repo } from "./repo.ts";

/** The findings the owner accepted as they stood, so a branch answers only for what it adds. Kept as owner state (docs/adr/0002). */
type Saved = { repo: string; saved: string; findings: string[] };

function identity(finding: Finding): string {
  return JSON.stringify([finding.check, finding.path, finding.key ?? finding.message]);
}

/** The repo's baseline file, named by its shared git folder, which the agent under review cannot rename from inside the repo. */
export async function baselineFile(repo: Repo): Promise<string> {
  const commonDir = await repo.commonDir();
  return ownerFile("baselines", `${createHash("sha256").update(commonDir).digest("hex").slice(0, 16)}.json`);
}

export async function saveBaseline(repo: Repo, findings: Finding[]): Promise<string> {
  const file = await baselineFile(repo);
  const saved: Saved = { repo: await repo.commonDir(), saved: new Date().toISOString(), findings: findings.map(identity).sort() };
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`);
  await rename(temporary, file);
  return file;
}

/**
 * Splits findings into those the baseline does not hold and those it does. Each saved entry covers one finding,
 * so a second copy of a known finding is new. With no baseline every finding is new; one that cannot be read is an error, not an empty baseline.
 */
export async function withoutBaseline(repo: Repo, findings: Finding[]): Promise<{ fresh: Finding[]; known: number }> {
  const file = await baselineFile(repo);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { fresh: findings, known: 0 };
    throw error;
  }
  let saved: Saved;
  try {
    saved = JSON.parse(text);
    if (!Array.isArray(saved.findings) || !saved.findings.every((entry) => typeof entry === "string")) throw new Error("no list of findings");
  } catch (error) {
    throw new Error(`cannot read the baseline ${file}: ${(error as Error).message}. Save it again with coherence check --save-baseline, or delete it`);
  }
  const left = new Map<string, number>();
  for (const entry of saved.findings) left.set(entry, (left.get(entry) ?? 0) + 1);
  const fresh: Finding[] = [];
  for (const finding of findings) {
    const count = left.get(identity(finding)) ?? 0;
    if (count > 0) left.set(identity(finding), count - 1);
    else fresh.push(finding);
  }
  return { fresh, known: findings.length - fresh.length };
}
