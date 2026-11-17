// The private MM → client channel: a sealed box only the client can open.
//
//  - The client's inbox key is derived from a wallet signature over a fixed message, so
//    the same wallet recreates the same key on any device and nothing secret is stored.
//    (Needs a wallet with repeatable signatures — standard EOAs are; the app checks the
//    derived public key against the registered one and says so if it differs.)
//  - Sealing: ephemeral X25519 → HKDF-SHA256 → AES-256-GCM. The `context` string (e.g.
//    the engagement's commitments) is bound in, so an envelope can't be replayed onto a
//    different engagement by whoever stores it — including our own server.

import { x25519 } from "@noble/curves/ed25519";
import { ab, bytesToHex, concatBytes, fromB64, hexToBytes, randomBytes, subtle, toB64, utf8 } from "./bytes.js";

export const INBOX_KEY_MESSAGE = [
  "MM Reputation: private inbox key (v1)",
  "",
  "Signing this creates the key that decrypts what market makers share with you.",
  "It costs nothing and sends no transaction.",
  "",
  "Only sign this message on the MM Reputation website.",
].join("\n");

export const SEAL_ALG = "x25519-hkdf-sha256-aes256gcm";

export interface SealedEnvelope {
  v: 1;
  alg: typeof SEAL_ALG;
  epk: string; // hex, ephemeral X25519 public key
  iv: string; // base64
  ct: string; // base64
}

async function hkdf32(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: ab(salt), info: ab(utf8(info)) }, k, 256));
}

/** Inbox keypair from a wallet's signature over INBOX_KEY_MESSAGE. */
export async function inboxKeyFromSignature(signatureHex: string): Promise<{ privateKey: Uint8Array; publicKey: `0x${string}` }> {
  const sig = hexToBytes(signatureHex);
  if (sig.length < 64) throw new Error("signature too short");
  const privateKey = await hkdf32(sig, utf8("mmr-inbox-v1"), "x25519-private-key");
  return { privateKey, publicKey: bytesToHex(x25519.getPublicKey(privateKey)) };
}

export function isPublicKeyHex(s: unknown): s is `0x${string}` {
  return typeof s === "string" && /^0x[0-9a-f]{64}$/.test(s);
}

async function aesKey(shared: Uint8Array, epk: Uint8Array, rpk: Uint8Array, context: string) {
  if (shared.every((b) => b === 0)) throw new Error("invalid public key");
  const raw = await hkdf32(shared, concatBytes(epk, rpk), `mmr-seal-v1:${context}`);
  return subtle().importKey("raw", ab(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(plaintext: string, recipientPublicKey: string, context: string): Promise<SealedEnvelope> {
  const rpk = hexToBytes(recipientPublicKey, 32);
  const esk = randomBytes(32);
  const epk = x25519.getPublicKey(esk);
  const key = await aesKey(x25519.getSharedSecret(esk, rpk), epk, rpk, context);
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: ab(iv), additionalData: ab(utf8(context)) }, key, ab(utf8(plaintext)));
  return { v: 1, alg: SEAL_ALG, epk: bytesToHex(epk), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function open(env: SealedEnvelope, privateKey: Uint8Array, context: string): Promise<string> {
  if (env?.v !== 1 || env.alg !== SEAL_ALG) throw new Error("unsupported envelope");
  const epk = hexToBytes(env.epk, 32);
  const rpk = x25519.getPublicKey(privateKey);
  const key = await aesKey(x25519.getSharedSecret(privateKey, epk), epk, rpk, context);
  try {
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: ab(fromB64(env.iv)), additionalData: ab(utf8(context)) }, key, ab(fromB64(env.ct)));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("this message can't be opened with your key");
  }
}

export function isEnvelope(x: unknown): x is SealedEnvelope {
  const e = x as SealedEnvelope;
  return (
    !!e && e.v === 1 && e.alg === SEAL_ALG && /^0x[0-9a-f]{64}$/.test(e.epk) &&
    typeof e.iv === "string" && e.iv.length <= 24 && typeof e.ct === "string" && e.ct.length <= 200_000
  );
}

/** Context strings bind an envelope to what it is about. */
export const contexts = {
  terms: (walletCommit: string, termsCommit: string) => `terms:${walletCommit}:${termsCommit}`,
  epoch: (registrationId: string, epoch: number) => `epoch:${registrationId}:${epoch}`,
};

/** What a client signs to accept an engagement. Server and browser build it identically. */
export function acceptanceMessage(a: { registrationId: string; walletCommit: string; termsCommit: string }): string {
  return [
    "MM Reputation: accept engagement",
    "",
    `Engagement: ${a.registrationId}`,
    `Wallet commitment: ${a.walletCommit}`,
    `Terms commitment: ${a.termsCommit}`,
    "",
    "By signing, I confirm I have reviewed these terms and agree to this engagement.",
    "This costs nothing and sends no transaction.",
  ].join("\n");
}
