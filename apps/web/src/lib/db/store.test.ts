import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "@mmr/db/migrate";
import {
  addEpochMessage,
  clientInboxKeyByAddress,
  getMidnightKey,
  setMidnightKey,
  createAccount,
  epochMessages,
  findAccountByAddress,
  ping,
  registerEngagement,
  registrationForParty,
  registrationsForClient,
  registrationsForMm,
  respondToRegistration,
  setInboxKey,
} from "./store";

// Real-Postgres tests for the account store and engagement registry. Skipped unless
// TEST_DATABASE_URL is set (CI provides a postgres service). Uses a throwaway database.
const ADMIN = process.env.TEST_DATABASE_URL;

const MM_WALLET = "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const MM2_WALLET = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const CLIENT_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const WC = `0x${"ab".repeat(32)}`;
const TC = `0x${"cd".repeat(32)}`;
const FP = `0x${"ef".repeat(32)}`;
const KEY = `0x${"12".repeat(32)}`;
const ENV = JSON.stringify({ v: 1, alg: "x25519-hkdf-sha256-aes256gcm", epk: `0x${"34".repeat(32)}`, iv: "AAAA", ct: "BBBB" });

describe.skipIf(!ADMIN)("postgres store (real Postgres)", () => {
  const name = `mmr_web_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const u = new URL(ADMIN!);
    u.pathname = `/${name}`;
    await migrate(u.toString());
    pool = new pg.Pool({ connectionString: u.toString(), max: 2 });
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("pings", async () => {
    expect(await ping(pool)).toBe(true);
  });

  it("creates an MM account and finds it by wallet, case-insensitively", async () => {
    const r = await createAccount(pool, MM_WALLET, 8453, { kind: "mm", handle: "acme", name: "Acme" });
    expect(r.ok).toBe(true);
    const found = await findAccountByAddress(pool, MM_WALLET.toUpperCase().replace("0X", "0x"));
    expect(found).toMatchObject({ kind: "mm", handle: "acme", name: "Acme" });
    expect(found?.id).toMatch(/^acc_[0-9a-f]{20}$/);
    expect(await findAccountByAddress(pool, MM2_WALLET)).toBeUndefined();
  });

  it("refuses a taken handle and a second account for the same wallet, atomically", async () => {
    expect(await createAccount(pool, MM2_WALLET, 1, { kind: "mm", handle: "acme", name: "Copycat" })).toEqual({ ok: false, error: "handle-taken" });
    // the failed attempt must not have left the wallet linked
    expect(await findAccountByAddress(pool, MM2_WALLET)).toBeUndefined();
    expect(await createAccount(pool, MM_WALLET, 1, { kind: "client", clientId: "x", name: "Again" })).toEqual({ ok: false, error: "wallet-linked" });
  });

  it("uses the database id as a client's id", async () => {
    const r = await createAccount(pool, CLIENT_WALLET, 8453, { kind: "client", clientId: "acct-ignored", name: "Nova Foundation" });
    expect(r.ok && r.account.kind === "client" && r.account.clientId === r.account.id).toBe(true);
  });

  it("needs the client's inbox key before registering, and sets that key only once", async () => {
    const mm = (await findAccountByAddress(pool, MM_WALLET))!;
    const client = (await findAccountByAddress(pool, CLIENT_WALLET))!;
    const reg = { mmAccountId: mm.id!, walletCommit: WC, termsCommit: TC, fingerprint: FP, termsEnvelope: ENV };

    expect(await registerEngagement(pool, { ...reg, clientAddress: MM2_WALLET })).toEqual({ ok: false, error: "client-not-found" });
    expect(await registerEngagement(pool, { ...reg, clientAddress: MM_WALLET })).toEqual({ ok: false, error: "client-not-found" }); // an MM is not a client
    expect(await registerEngagement(pool, { ...reg, clientAddress: CLIENT_WALLET })).toEqual({ ok: false, error: "client-no-inbox" });

    expect(await clientInboxKeyByAddress(pool, CLIENT_WALLET)).toEqual({ found: true, encryptionKey: null, midnightCoinKey: null });
    expect(await setInboxKey(pool, client.id!, KEY)).toBe("set");
    expect(await setInboxKey(pool, client.id!, KEY)).toBe("unchanged");
    expect(await setInboxKey(pool, client.id!, `0x${"99".repeat(32)}`)).toBe("conflict");
    expect(await clientInboxKeyByAddress(pool, CLIENT_WALLET)).toEqual({ found: true, encryptionKey: KEY, midnightCoinKey: null });
    expect(await clientInboxKeyByAddress(pool, MM_WALLET)).toEqual({ found: false, encryptionKey: null, midnightCoinKey: null });
    // The client's own Midnight key (the bond's beneficiary) comes back with it once saved.
    await setMidnightKey(pool, client.id!, "ab".repeat(32));
    expect(await getMidnightKey(pool, client.id!)).toBe("ab".repeat(32));
    expect((await clientInboxKeyByAddress(pool, CLIENT_WALLET)).midnightCoinKey).toBe("ab".repeat(32));
  });

  it("registers a proposal with sealed terms, visible only to the two parties", async () => {
    const mm = (await findAccountByAddress(pool, MM_WALLET))!;
    const client = (await findAccountByAddress(pool, CLIENT_WALLET))!;
    const r = await registerEngagement(pool, { mmAccountId: mm.id!, clientAddress: CLIENT_WALLET.toLowerCase(), walletCommit: WC, termsCommit: TC, fingerprint: FP, termsEnvelope: ENV });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registration).toMatchObject({ commitment: FP, walletCommit: WC, termsCommit: TC, status: "proposed", counterparty: "Nova Foundation", respondedAt: null });
    expect(r.registration.id).toMatch(/^rec_[0-9a-f]{12}$/);
    expect(await registerEngagement(pool, { mmAccountId: mm.id!, clientAddress: CLIENT_WALLET, walletCommit: WC, termsCommit: TC, fingerprint: FP, termsEnvelope: ENV })).toEqual({ ok: false, error: "duplicate" });

    const asClient = await registrationForParty(pool, r.registration.id, client.id!);
    expect(asClient).toMatchObject({ role: "client", termsEnvelope: ENV, registration: { counterparty: "Acme" } });
    const asMm = await registrationForParty(pool, r.registration.id, mm.id!);
    expect(asMm).toMatchObject({ role: "mm", registration: { counterparty: "Nova Foundation" } });

    const other = await createAccount(pool, MM2_WALLET, 1, { kind: "mm", handle: "other-mm", name: "Other" });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(await registrationForParty(pool, r.registration.id, other.account.id!)).toBeUndefined();
    expect(await registrationsForMm(pool, other.account.id!)).toEqual([]);
    expect(await epochMessages(pool, r.registration.id, other.account.id!)).toBeUndefined();

    expect((await registrationsForClient(pool, client.id!)).map((x) => [x.id, x.counterparty, x.mmHandle, x.status])).toEqual([[r.registration.id, "Acme", "acme", "proposed"]]);
  });

  it("only the client responds, once; epoch figures flow only after acceptance", async () => {
    const mm = (await findAccountByAddress(pool, MM_WALLET))!;
    const client = (await findAccountByAddress(pool, CLIENT_WALLET))!;
    const [reg] = await registrationsForMm(pool, mm.id!);
    const id = reg!.id;

    expect(await addEpochMessage(pool, { id, mmAccountId: mm.id!, epoch: 1, envelope: ENV })).toBe("not-accepted");
    expect(await respondToRegistration(pool, { id, clientAccountId: mm.id!, decision: "accept", signature: "0xsig", signer: MM_WALLET })).toBe(false);
    expect(await respondToRegistration(pool, { id, clientAccountId: client.id!, decision: "accept", signature: "0xsig", signer: CLIENT_WALLET })).toBe(true);
    expect(await respondToRegistration(pool, { id, clientAccountId: client.id!, decision: "decline" })).toBe(false);

    const after = (await registrationForParty(pool, id, mm.id!))!.registration;
    expect(after.status).toBe("accepted");
    expect(after.respondedAt).not.toBeNull();
    const row = (await pool.query(`SELECT "acceptSignature", "acceptedBy" FROM engagement_registration WHERE id = $1`, [id])).rows[0];
    expect(row).toEqual({ acceptSignature: "0xsig", acceptedBy: CLIENT_WALLET.toLowerCase() });

    expect(await addEpochMessage(pool, { id, mmAccountId: client.id!, epoch: 1, envelope: ENV })).toBe("not-found");
    expect(await addEpochMessage(pool, { id, mmAccountId: mm.id!, epoch: 1, envelope: ENV })).toBe("ok");
    expect(await addEpochMessage(pool, { id, mmAccountId: mm.id!, epoch: 1, envelope: ENV })).toBe("duplicate");
    expect((await epochMessages(pool, id, client.id!))!.map((m) => m.epoch)).toEqual([1]);
  });
});
