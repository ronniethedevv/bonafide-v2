// The agent's local state, on the MM's own machine (default ~/.mmr-agent, or MMR_AGENT_HOME):
//   config.json                  server URL + agent token (file mode 0600)
//   engagements/<id>.mmr.json    the engagement files, still passphrase-encrypted
//   witnesses/<id>/epoch-<n>.json  captured witnesses (private; never uploaded)

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngagementFile } from "@mmr/engagement-file";

export interface AgentConfig {
  server: string;
  token: string;
}

export class AgentHome {
  constructor(readonly root: string = process.env.MMR_AGENT_HOME ?? join(homedir(), ".mmr-agent")) {
    mkdirSync(join(root, "engagements"), { recursive: true });
  }

  get witnessDir(): string {
    return join(this.root, "witnesses");
  }

  readConfig(): AgentConfig {
    const f = join(this.root, "config.json");
    if (!existsSync(f)) throw new Error("not connected yet: run `connect --server <url> --token <token>` first");
    return JSON.parse(readFileSync(f, "utf8")) as AgentConfig;
  }

  writeConfig(c: AgentConfig): void {
    const f = join(this.root, "config.json");
    writeFileSync(f, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
    chmodSync(f, 0o600);
  }

  private engagementPath(id: string): string {
    if (!/^[a-z0-9_]{1,40}$/.test(id)) throw new Error(`bad engagement id: ${id}`);
    return join(this.root, "engagements", `${id}.mmr.json`);
  }

  saveEngagementFile(id: string, file: EngagementFile): void {
    writeFileSync(this.engagementPath(id), JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  }

  readEngagementFile(id: string): EngagementFile {
    const p = this.engagementPath(id);
    if (!existsSync(p)) throw new Error(`engagement ${id} isn't imported: run \`import <file> --engagement ${id}\``);
    return JSON.parse(readFileSync(p, "utf8")) as EngagementFile;
  }

  hasEngagement(id: string): boolean {
    return existsSync(this.engagementPath(id));
  }
}
