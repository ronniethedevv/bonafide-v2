import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { SIWE_STATEMENT, verifySignIn, type SiweExpectation } from "./siwe";
import { readToken, sessionKey, signToken, SESSION_AUD, type WalletClaims } from "./token";
import { parseWalletLinks, validateNewAccount } from "./accounts";

// Well-known test keys (anvil defaults) — never hold funds.
const alice = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const mallory = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const DOMAIN = "mm.example";
const ORIGIN = "https://mm.example";
const T0 = new Date("2026-11-17T10:00:00Z");

function message(over: Partial<Parameters<typeof createSiweMessage>[0]> = {}, nonce = "abcdef12345678") {
  return createSiweMessage({
    address: alice.address,
    chainId: 8453,
    domain: DOMAIN,
    uri: ORIGIN,
    version: "1",
    nonce,
    statement: SIWE_STATEMENT,
    issuedAt: T0,
    expirationTime: new Date(T0.getTime() + 10 * 60_000),
    ...over,
  });
}

const expect0 = (over: Partial<SiweExpectation> = {}): SiweExpectation => ({
  domain: DOMAIN,
  origin: ORIGIN,
  nonce: "abcdef12345678",
  now: new Date(T0.getTime() + 30_000),
  ...over,
});

describe("verifySignIn", () => {
  it("accepts a fresh message signed by the named address (local, no RPC)", async () => {
    const msg = message();
    const sig = await alice.signMessage({ message: msg });
    const r = await verifySignIn(msg, sig, expect0());
    expect(r).toEqual({ ok: true, address: alice.address, chainId: 8453, kind: "eoa" });
  });

  it("accepts Ethereum mainnet too", async () => {
    const msg = message({ chainId: 1 });
    const r = await verifySignIn(msg, await alice.signMessage({ message: msg }), expect0());
    expect(r.ok && r.chainId).toBe(1);
  });

  it("rejects a signature from a different key", async () => {
    const msg = message();
    const r = await verifySignIn(msg, await mallory.signMessage({ message: msg }), expect0());
    expect(r).toEqual({ ok: false, reason: "signature does not match the address" });
  });

  it("rejects a message edited after signing", async () => {
    const msg = message();
    const sig = await alice.signMessage({ message: msg });
    const edited = msg.replace("Chain ID: 8453", "Chain ID: 1");
    expect((await verifySignIn(edited, sig, expect0())).ok).toBe(false);
  });

  it.each([
    ["another site's domain", { domain: "evil.example" }, "message was signed for a different site"],
    ["another site's origin", { origin: "https://evil.example" }, "message was signed for a different site"],
    ["a stale or reused nonce", { nonce: "zzzzzzzz000000" }, "sign-in request expired or already used; try again"],
    ["an expired request", { now: new Date(T0.getTime() + 11 * 60_000) }, "sign-in request expired; try again"],
  ])("rejects %s", async (_label, over, reason) => {
    const msg = message();
    const r = await verifySignIn(msg, await alice.signMessage({ message: msg }), expect0(over as Partial<SiweExpectation>));
    expect(r).toEqual({ ok: false, reason });
  });

  it("rejects chains we don't index", async () => {
    const msg = message({ chainId: 10 });
    const r = await verifySignIn(msg, await alice.signMessage({ message: msg }), expect0());
    expect(r).toEqual({ ok: false, reason: "unsupported chain (use Ethereum or Base)" });
  });

  it("rejects a long-lived message and a different statement", async () => {
    const long = message({ expirationTime: new Date(T0.getTime() + 24 * 3600_000) });
    expect((await verifySignIn(long, await alice.signMessage({ message: long }), expect0())).ok).toBe(false);
    const other = message({ statement: "Approve everything" });
    expect(await verifySignIn(other, await alice.signMessage({ message: other }), expect0())).toEqual({
      ok: false,
      reason: "unexpected sign-in statement",
    });
  });

  it("rejects garbage", async () => {
    expect((await verifySignIn("hello", "0x00", expect0())).ok).toBe(false);
  });

  it("generates unpredictable nonces", () => {
    expect(generateSiweNonce()).not.toBe(generateSiweNonce());
  });
});

describe("session tokens", () => {
  const key = sessionKey({ SESSION_SECRET: "x".repeat(40) })!;

  it("round-trips claims and rejects tampering, wrong audience or wrong key", async () => {
    const claims: WalletClaims = { addr: alice.address, chainId: 8453, acct: { kind: "mm", handle: "acme", name: "Acme" } };
    const tok = await signToken(claims, key, SESSION_AUD, 60);
    expect(await readToken<WalletClaims>(tok, key, SESSION_AUD)).toMatchObject(claims);
    expect(await readToken(tok, key, "other")).toBeUndefined();
    expect(await readToken(tok, sessionKey({ SESSION_SECRET: "y".repeat(40) })!, SESSION_AUD)).toBeUndefined();
    const [h, p, s] = tok.split(".");
    const forged = JSON.parse(Buffer.from(p!, "base64url").toString());
    forged.acct = { kind: "mm", handle: "vega-mm", name: "Vega" };
    expect(await readToken(`${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`, key, SESSION_AUD)).toBeUndefined();
  });

  it("refuses to run production on a missing or weak secret", () => {
    expect(sessionKey({ NODE_ENV: "production" })).toBeUndefined();
    expect(sessionKey({ NODE_ENV: "production", SESSION_SECRET: "short" })).toBeUndefined();
    expect(sessionKey({ NODE_ENV: "production", SESSION_SECRET: "s".repeat(32) })).toBeInstanceOf(Uint8Array);
    expect(sessionKey({ NODE_ENV: "development" })).toBeInstanceOf(Uint8Array);
  });
});

describe("accounts", () => {
  it("won't let a new account claim an existing market maker's handle or name", () => {
    const taken = validateNewAccount({ role: "mm", name: "Acme Liquidity", handle: "vega-mm" }, alice.address);
    expect(taken).toEqual({ ok: false, errors: { handle: "That handle is taken." } });
    const name = validateNewAccount({ role: "mm", name: "Vega Market Making", handle: "vega-2" }, alice.address);
    expect(name.ok).toBe(false);
  });

  it("accepts a valid market maker and derives a stable client id", () => {
    expect(validateNewAccount({ role: "mm", name: " Acme  Liquidity ", handle: "acme-lq" }, alice.address)).toEqual({
      ok: true,
      account: { kind: "mm", handle: "acme-lq", name: "Acme Liquidity" },
    });
    const c = validateNewAccount({ role: "client", name: "Nova DAO" }, alice.address);
    expect(c).toEqual({ ok: true, account: { kind: "client", clientId: `acct-${alice.address.slice(2, 12).toLowerCase()}`, name: "Nova DAO" } });
  });

  it("validates role, name and handle shape", () => {
    expect(validateNewAccount({ role: "admin", name: "X Y" }, alice.address).ok).toBe(false);
    expect(validateNewAccount({ role: "mm", name: "A", handle: "-bad-" }, alice.address)).toEqual({
      ok: false,
      errors: { name: "Use 2 to 60 characters.", handle: "3 to 30 characters: lowercase letters, numbers and dashes." },
    });
  });

  it("parses operator wallet links to demo accounts and ignores junk", () => {
    const links = parseWalletLinks(`${alice.address}=mm:vega-mm, ${mallory.address}=client:orion, 0x123=mm:vega-mm, ${alice.address}=mm:nope`);
    expect(links.get(alice.address.toLowerCase())).toEqual({ kind: "mm", handle: "vega-mm", name: "Vega Market Making" });
    expect(links.get(mallory.address.toLowerCase())).toEqual({ kind: "client", clientId: "orion", name: "Orion Capital" });
    expect(links.size).toBe(2);
  });
});
