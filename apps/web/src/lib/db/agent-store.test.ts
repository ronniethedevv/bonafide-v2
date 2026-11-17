import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "@mmr/db/migrate";
import { createAccount, registerEngagement, respondToRegistration, setInboxKey, registrationsForMm } from "./store";
import { agentEngagements, authenticateAgent, createAgentToken, listAgentTokens, reportEpochPhase, revokeAgentToken } from "./agent-store";

// Real-Postgres tests for agent tokens and epoch progress (skipped without TEST_DATABASE_URL).
const ADMIN = process.env.TEST_DATABASE_URL;
const MM = "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const CLIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ENV = JSON.stringify({ v: 1, alg: "x25519-hkdf-sha256-aes256gcm", epk: `0x${"34".repeat(32)}`, iv: "AAAA", ct: "BBBB" });

describe.skipIf(!ADMIN)("agent store (real Postgres)", () => {
  const name = `mmr_agent_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let pool: pg.Pool;
  let mmId = "";
  let clientId = "";
  let regId = "";

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const u = new URL(ADMIN!);
    u.pathname = `/${name}`;
    await migrate(u.toString());
    pool = new pg.Pool({ connectionString: u.toString(), max: 2 });
    const mm = await createAccount(pool, MM, 8453, { kind: "mm", handle: "acme", name: "Acme" });
    const cl = await createAccount(pool, CLIENT, 8453, { kind: "client", clientId: "x", name: "Nova" });
    if (!mm.ok || !cl.ok) throw new Error("setup");
    mmId = mm.account.id!;
    clientId = cl.account.id!;
    await setInboxKey(pool, clientId, `0x${"12".repeat(32)}`);
    const r = await registerEngagement(pool, { mmAccountId: mmId, clientAddress: CLIENT, walletCommit: `0x${"ab".repeat(32)}`, termsCommit: `0x${"cd".repeat(32)}`, fingerprint: `0x${"ef".repeat(32)}`, termsEnvelope: ENV });
    if (!r.ok) throw new Error("setup");
    regId = r.registration.id;
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("issues tokens stored only as hashes, authenticates them, and revokes them", async () => {
    const { id, token } = await createAgentToken(pool, mmId, "Agent");
    expect(token).toMatch(/^mmra_[A-Za-z0-9_-]{43}$/);
    const stored = (await pool.query(`SELECT "tokenHash" FROM agent_token WHERE id = $1`, [id])).rows[0].tokenHash;
    expect(stored).not.toContain(token.slice(5)); // only the hash is kept
    expect(await authenticateAgent(pool, token)).toMatchObject({ accountId: mmId, handle: "acme" });
    expect(await authenticateAgent(pool, token + "x")).toBeUndefined();
    expect((await listAgentTokens(pool, mmId))[0]!.lastUsedAt).not.toBeNull();
    expect(await revokeAgentToken(pool, clientId, id)).toBe(false); // not theirs
    expect(await revokeAgentToken(pool, mmId, id)).toBe(true);
    expect(await authenticateAgent(pool, token)).toBeUndefined();
  });

  it("a client account's token never authenticates as an agent", async () => {
    const { token } = await createAgentToken(pool, clientId, "Not an MM");
    expect(await authenticateAgent(pool, token)).toBeUndefined();
  });

  it("reports phases only after acceptance, only forward, and marks the engagement active", async () => {
    expect(await reportEpochPhase(pool, { registrationId: regId, mmAccountId: mmId, epoch: 1, phase: "captured" })).toBe("not-accepted");
    await respondToRegistration(pool, { id: regId, clientAccountId: clientId, decision: "accept", signature: "0xsig", signer: CLIENT });
    expect(await reportEpochPhase(pool, { registrationId: regId, mmAccountId: clientId, epoch: 1, phase: "captured" })).toBe("not-found");
    expect(await reportEpochPhase(pool, { registrationId: regId, mmAccountId: mmId, epoch: 1, phase: "captured" })).toBe("ok");
    expect(await reportEpochPhase(pool, { registrationId: regId, mmAccountId: mmId, epoch: 1, phase: "captured" })).toBe("unchanged");
    expect(await reportEpochPhase(pool, { registrationId: regId, mmAccountId: mmId, epoch: 1, phase: "proven" })).toBe("ok");
    expect(await reportEpochPhase(pool, { registrationId: regId, mmAccountId: mmId, epoch: 1, phase: "captured" })).toBe("backwards");
    expect(await reportEpochPhase(pool, { registrationId: regId, mmAccountId: mmId, epoch: 2, phase: "captured" })).toBe("ok");

    const [e] = await agentEngagements(pool, mmId);
    expect(e).toMatchObject({ id: regId, status: "active", clientName: "Nova", clientInboxKey: `0x${"12".repeat(32)}` });
    expect(e!.epochs).toEqual([{ epoch: 1, phase: "proven" }, { epoch: 2, phase: "captured" }]);
    const [listed] = await registrationsForMm(pool, mmId);
    expect(listed).toMatchObject({ status: "active", lastEpoch: 2, lastPhase: "captured" });
  });
});
