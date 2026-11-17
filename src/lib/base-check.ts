import type { Repo } from "./repo.ts";

/** What a finding is about, which decides when a branch is answerable for it: the file changed, or the folder holds more source files than where the branch began. */
export type Scope = "file" | "folder";

/** A must-fix finding keeps the branch from being clean; a note is reported but leaves it clean (docs/adr/0001). */
export type Tier = "must-fix" | "note";

/**
 * `path` is always relative to the repo root, whatever tool found the problem.
 * `key` is what stays the same about the finding while lines around it move, so a baseline still knows it; the message when absent.
 */
export type Finding = { check: string; tier: Tier; path: string; line?: number; scope: Scope; message: string; key?: string };

/** A deterministic rule about the code. Adding a rule means adding one file in `checks/`. */
export abstract class BaseCheck {
  abstract readonly name: string;

  /** Each check sits in one tier, chosen when it is built: one that is sometimes right to fire and sometimes not is a note. */
  readonly tier: Tier = "must-fix";

  /** `base` is the ref a branch is checked against, when there is one; most checks read only the code as it is now. */
  abstract run(repo: Repo, base?: string): Promise<Finding[]>;

  protected finding(path: string, message: string, { line, scope = "file", key }: { line?: number; scope?: Scope; key?: string } = {}): Finding {
    return { check: this.name, tier: this.tier, path, line, scope, message, key };
  }
}
