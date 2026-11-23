// mmr-agent — the market maker's agent, on the command line.
//
//   pnpm --filter @mmr/agent agent connect --server https://… --token mmra_…
//   pnpm --filter @mmr/agent agent create --client 0x… --pool 0x… --pair VIRTUAL/USDC \
//        --wallets 0x…,0x… --terms terms.json --tier 1 --bond 10000 --out engagement.mmr.json
//   pnpm --filter @mmr/agent agent propose engagement.mmr.json --signatures engagement.mmr.json.ownership.json
//   pnpm --filter @mmr/agent agent import ./engagement-ab12cd34.mmr.json --engagement rec_…
//   pnpm --filter @mmr/agent agent run --engagement rec_… --epoch 1 --source replay:<dir>
//   pnpm --filter @mmr/agent agent status
//
// The engagement passphrase is read from MMR_ENGAGEMENT_PASSPHRASE, or asked for.
//
// create and propose keep the trading wallets on this machine: the engagement file is
// created and sealed here, each wallet signs an ownership message (a signature, no
// transaction; a custody platform can approve it under a signing policy), and the server
// receives only the two commitments and the terms sealed to the client's inbox key.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { openFile, sealFile, type EngagementFile, type TermsJson, type TokenInfo } from "@mmr/engagement-file";
import { FsWitnessStore } from "@mmr/witness";
import { AgentApi } from "./api.js";
import { matchesServer } from "./engagement.js";
import { attachOwnership, createOpening, ownershipTasks, proposalFor } from "./propose.js";
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
    case "create": {
      const need = ["client", "pool", "pair", "wallets", "terms", "tier", "bond", "out"].filter((k) => !opts[k]);
      if (need.length) throw new Error(`usage: create --client 0x… --pool 0x… --pair BASE/QUOTE --wallets 0x…,0x… --terms terms.json --tier 1|2|3 --bond <amount> --out <file> [--chain 8453] [--base SYM:decimals] [--quote SYM:decimals] [--label <text>] (missing: ${need.join(", ")})`);
      const out = resolve(CWD, opts.out!);
      if (existsSync(out)) throw new Error(`${out} exists; an engagement file is never replaced`);
      const cfg = home.readConfig();
      const api = new AgentApi(cfg.server, cfg.token);
      const keys = await api.clientKeys(opts.client!);
      const token = (v: string | undefined): TokenInfo | undefined => {
        const m = v ? /^([^:]+):(\d+)$/.exec(v) : null;
        return m ? { symbol: m[1]!, decimals: Number(m[2]) } : undefined;
      };
      const [base, quote] = [token(opts.base), token(opts.quote)];
      const opening = await createOpening({
        clientAddress: opts.client!,
        beneficiary: keys.midnightCoinKey ?? "",
        chainId: Number(opts.chain ?? 8453),
        pool: { address: opts.pool!, pair: opts.pair!, ...(base ? { base } : {}), ...(quote ? { quote } : {}) },
        wallets: opts.wallets!.split(","),
        terms: JSON.parse(readFileSync(resolve(CWD, opts.terms!), "utf8")) as TermsJson,
        tier: Number(opts.tier),
        bond: opts.bond!.replace(/,/g, ""),
        ...(opts.label ? { label: opts.label } : {}),
      });
      writeFileSync(out, `${JSON.stringify(await sealFile(opening, await passphrase()), null, 2)}\n`);
      const tasks = await ownershipTasks(opening);
      const sigFile = `${out}.ownership.json`;
      writeFileSync(sigFile, `${JSON.stringify(Object.fromEntries(tasks.map((t) => [t.wallet, { message: t.message, signature: "" }])), null, 2)}\n`);
      console.log(`Engagement file sealed: ${out}`);
      console.log(`  wallet commitment  ${opening.commitments.walletCommit}`);
      console.log(`  terms commitment   ${opening.commitments.termsCommit}`);
      console.log(`\nEach wallet signs its message (a signature, not a transaction). Fill in the signatures in\n  ${sigFile}\nthen run: propose ${opts.out} --signatures ${opts.out}.ownership.json`);
      break;
    }
    case "propose": {
      const path = positional[0];
      if (!path || !opts.signatures) throw new Error("usage: propose <engagement file> --signatures <ownership.json>");
      const cfg = home.readConfig();
      const api = new AgentApi(cfg.server, cfg.token);
      const pass = await passphrase();
      const opening = await openFile(JSON.parse(readFileSync(resolve(CWD, path), "utf8")) as EngagementFile, pass);
      const raw = JSON.parse(readFileSync(resolve(CWD, opts.signatures), "utf8")) as Record<string, string | { signature?: string }>;
      const signatures = Object.fromEntries(Object.entries(raw).map(([w, v]) => [w, typeof v === "string" ? v : (v.signature ?? "")]));
      const owned = await attachOwnership(opening, signatures);
      // The file keeps the signatures too: it is the market maker's full record of the engagement.
      const file = await sealFile(owned, pass);
      writeFileSync(resolve(CWD, path), `${JSON.stringify(file, null, 2)}\n`);
      const keys = await api.clientKeys(owned.client.address!);
      const r = await api.propose(await proposalFor(owned, keys.encryptionKey));
      home.saveEngagementFile(r.id, file);
      console.log(`Proposed ${r.id}${r.clientName ? ` to ${r.clientName}` : ""}: every wallet's ownership proven; the server received the two commitments and the terms sealed to your client, nothing else.`);
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
      console.log("usage: mmr-agent <connect|create|propose|import|run|status> …  (see packages/agent/src/cli.ts)");
      process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
