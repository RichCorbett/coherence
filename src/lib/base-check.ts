import type { Repo } from "./repo.ts";

/** What a finding is about, which decides when a branch is answerable for it: the file changed, or the folder holds more source files than where the branch began. */
export type Scope = "file" | "folder";

/** `path` is always relative to the repo root, whatever tool found the problem. */
export type Finding = { check: string; path: string; line?: number; scope: Scope; message: string };

/** A deterministic rule about the code. Adding a rule means adding one file in `checks/`. */
export abstract class BaseCheck {
  abstract readonly name: string;

  abstract run(repo: Repo): Promise<Finding[]>;

  protected finding(path: string, message: string, { line, scope = "file" }: { line?: number; scope?: Scope } = {}): Finding {
    return { check: this.name, path, line, scope, message };
  }
}
