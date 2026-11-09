import type { Repo } from "./repo.ts";

export type Finding = { check: string; path: string; line?: number; message: string };

/** A deterministic rule about the code. Adding a rule means adding one file in `checks/`. */
export abstract class BaseCheck {
  abstract readonly name: string;

  abstract run(repo: Repo): Promise<Finding[]>;

  protected finding(path: string, message: string, line?: number): Finding {
    return { check: this.name, path, line, message };
  }
}
