import { homedir } from "node:os";
import { join } from "node:path";

// Outside the repo and the plugin: the agent under review can edit the repo, and a plugin update replaces the plugin (docs/adr/0002).
/** A file in the owner's coherence config folder. */
export function ownerFile(...parts: string[]): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "coherence", ...parts);
}
