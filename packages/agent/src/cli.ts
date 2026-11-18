// mmr-agent — the market maker's agent, on the command line.
//
//   pnpm --filter @mmr/agent agent connect --server https://… --token mmra_…
//   pnpm --filter @mmr/agent agent import ./engagement-ab12cd34.mmr.json --engagement rec_…
//   pnpm --filter @mmr/agent agent run --engagement rec_… --epoch 1 --source replay:<dir>
//   pnpm --filter @mmr/agent agent status
//
// The engagement passphrase is read from MMR_ENGAGEMENT_PASSPHRASE, or asked for.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { openFile, type EngagementFile } from "@mmr/engagement-file";
import { FsWitnessStore } from "@mmr/witness";
import { AgentApi } from "./api.js";
import { matchesServer } from "./engagement.js";
import { AgentHome } from "./home.js";
import { runEpoch } from "./run.js";
import { replaySource, type ActivitySource } from "./sources.js";

// pnpm runs scripts from the package folder; resolve user paths against where they ran it.
const CWD = process.env.INIT_CWD ?? process.cwd();

function flags(args: string[]): { positional: string[]; opts: Record<string, string> } {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) opts[a.slice(2)] = args[++i] ?? "";
    else positional.push(a);
  }
  return { positional, opts };
}

async function passphrase(): Promise<string> {
  if (process.env.MMR_ENGAGEMENT_PASSPHRASE) return process.env.MMR_ENGAGEMENT_PASSPHRASE;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const p = await rl.question("Engagement file passphrase: ");
  rl.close();
  return p;
}

function sourceFrom(spec: string | undefined): ActivitySource {
  if (spec?.startsWith("replay:")) return replaySource(resolve(CWD, spec.slice("replay:".length)));
  throw new Error("--source replay:<dir> is the only source in this preview (published and rpc sources are planned)");
}

const home = new AgentHome();
const [cmd, ...rest] = process.argv.slice(2);
const { positional, opts } = flags(rest);

try {
  switch (cmd) {
    case "connect": {
      if (!opts.server || !opts.token) throw new Error("usage: connect --server <url> --token <agent token>");
      const me = await new AgentApi(opts.server, opts.token).me();
      home.writeConfig({ server: opts.server, token: opts.token });
      console.log(`Connected as ${me.name} (@${me.handle}). Config saved in ${home.root}.`);
      break;
    }
    case "import": {
      const path = positional[0];
      if (!path || !opts.engagement) throw new Error("usage: import <engagement-file> --engagement <rec_id>");
      const cfg = home.readConfig();
      const api = new AgentApi(cfg.server, cfg.token);
      const file = JSON.parse(readFileSync(resolve(CWD, path), "utf8")) as EngagementFile;
      const opening = await openFile(file, await passphrase());
      const reg = (await api.engagements()).find((e) => e.id === opts.engagement);
      if (!reg) throw new Error(`${opts.engagement} isn't one of your engagements`);
      if (!matchesServer(opening, reg)) throw new Error(`this file's commitments don't match ${reg.id}`);
      home.saveEngagementFile(reg.id, file);
      console.log(`Imported ${reg.id}: ${opening.pool.pair} on ${opening.pool.chain}, ${opening.wallets.length} wallet(s), with ${reg.clientName} (${reg.status}).`);
      break;
    }
    case "run": {
      if (!opts.engagement || !opts.epoch) throw new Error("usage: run --engagement <rec_id> --epoch <n> --source replay:<dir>");
      const cfg = home.readConfig();
      const r = await runEpoch({
        api: new AgentApi(cfg.server, cfg.token),
        home,
        registrationId: opts.engagement,
        epoch: Number(opts.epoch),
        source: sourceFrom(opts.source),
        passphrase: await passphrase(),
      });
      console.log(
        `Epoch ${r.epoch}: ${r.reused ? "witness already captured" : "captured"} · ${r.bucketsAtTarget}/48 half-hours at target · ${r.met ? "met" : "missed"} · ` +
          `${r.phaseChanged ? "reported" : "already reported"} · ${r.figuresPosted ? "figures sent to client" : "figures already sent"} · proof pending (Midnight)`,
      );
      break;
    }
    case "status": {
      const cfg = home.readConfig();
      const store = new FsWitnessStore(home.witnessDir);
      for (const e of await new AgentApi(cfg.server, cfg.token).engagements()) {
        const local = store.list(e.id).length;
        console.log(`${e.id}  ${e.status.padEnd(9)} with ${e.clientName}  · imported: ${home.hasEngagement(e.id) ? "yes" : "no"} · captured locally: ${local} · reported: ${e.epochs.length}`);
      }
      break;
    }
    default:
      console.log("usage: mmr-agent <connect|import|run|status> …  (see packages/agent/src/cli.ts)");
      process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
