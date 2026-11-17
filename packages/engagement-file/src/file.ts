// The engagement file: everything a market maker needs to later prove an engagement —
// the terms, the quoting wallets and the three secrets — encrypted with a passphrase.
// Without it a registered engagement can never be proven, so the app makes the MM save
// it BEFORE anything is registered.
//
// Format: PBKDF2-SHA256 (600k iterations) → AES-256-GCM. The two public commitments
// sit in clear in `hint` (so a file can be matched to its registration without the
// passphrase) and are bound into the ciphertext as additional data.

import { ab, bytesToHex, fromB64, hexToBytes, randomBytes, subtle, toB64, utf8 } from "./bytes.js";
import { termsCommit, termsFromJson, termsToJson, walletCommit, type Terms, type TermsJson } from "./commitments.js";

export const FILE_FORMAT = "mmr-engagement-file";
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 12;

export interface EngagementOpening {
  v: 1;
  pool: { chain: string; address: string; pair: string };
  /** Who the engagement is with (private to the two parties). */
  client: { name?: string; address?: string };
  /** The MM's own label for the deal. */
  label?: string;
  /** Active quoting wallets (lowercase 0x addresses). */
  wallets: string[];
  terms: TermsJson;
  /** Human-entered amounts the terms were derived from, for display. */
  human: Record<string, string>;
  secrets: {
    /** Derives the on-chain engagement id (contract witness engagementSecret). */
    engagementSecret: `0x${string}`;
    walletSalt: `0x${string}`;
    termsSalt: `0x${string}`;
  };
  commitments: { walletCommit: `0x${string}`; termsCommit: `0x${string}` };
  createdAt: string;
}

export interface EngagementFile {
  format: typeof FILE_FORMAT;
  v: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  hint: { walletCommit: string; termsCommit: string; createdAt: string };
  ciphertext: string;
}

/** Fresh secrets + real commitments for a new engagement. */
export async function newOpening(input: {
  pool: EngagementOpening["pool"];
  client: EngagementOpening["client"];
  label?: string;
  wallets: string[];
  terms: Terms;
  human: Record<string, string>;
}): Promise<EngagementOpening> {
  const engagementSecret = randomBytes(32);
  const walletSalt = randomBytes(32);
  const termsSalt = randomBytes(32);
  const wallets = input.wallets.map((w) => w.toLowerCase());
  return {
    v: 1,
    pool: input.pool,
    client: input.client,
    ...(input.label ? { label: input.label } : {}),
    wallets,
    terms: termsToJson(input.terms),
    human: input.human,
    secrets: {
      engagementSecret: bytesToHex(engagementSecret),
      walletSalt: bytesToHex(walletSalt),
      termsSalt: bytesToHex(termsSalt),
    },
    commitments: {
      walletCommit: await walletCommit(wallets, walletSalt),
      termsCommit: await termsCommit(input.terms, termsSalt),
    },
    createdAt: new Date().toISOString(),
  };
}

/** Recompute both commitments from the opening; throws if they don't match what it claims. */
export async function verifyOpening(o: EngagementOpening): Promise<void> {
  const wc = await walletCommit(o.wallets, hexToBytes(o.secrets.walletSalt, 32));
  const tc = await termsCommit(termsFromJson(o.terms), hexToBytes(o.secrets.termsSalt, 32));
  if (wc !== o.commitments.walletCommit || tc !== o.commitments.termsCommit) {
    throw new Error("the terms and wallets do not match the commitments");
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await subtle().importKey("raw", ab(utf8(passphrase.normalize("NFKC"))), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: ab(salt), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(hint: EngagementFile["hint"]): ArrayBuffer {
  return ab(utf8(`${FILE_FORMAT}:v1:${hint.walletCommit}:${hint.termsCommit}:${hint.createdAt}`));
}

export async function sealFile(o: EngagementOpening, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<EngagementFile> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`passphrase must be at least ${MIN_PASSPHRASE} characters`);
  await verifyOpening(o);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const hint = { walletCommit: o.commitments.walletCommit, termsCommit: o.commitments.termsCommit, createdAt: o.createdAt };
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: ab(iv), additionalData: aad(hint) }, key, ab(utf8(JSON.stringify(o))));
  return {
    format: FILE_FORMAT,
    v: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toB64(salt) },
    cipher: { name: "AES-GCM", iv: toB64(iv) },
    hint,
    ciphertext: toB64(new Uint8Array(ct)),
  };
}

/** Decrypt and check a file. Throws on a wrong passphrase, tampering, or mismatched commitments. */
export async function openFile(file: EngagementFile, passphrase: string): Promise<EngagementOpening> {
  if (file?.format !== FILE_FORMAT || file.v !== 1) throw new Error("not an MM Reputation engagement file");
  const key = await deriveKey(passphrase, fromB64(file.kdf.salt), file.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: ab(fromB64(file.cipher.iv)), additionalData: aad(file.hint) }, key, ab(fromB64(file.ciphertext)));
  } catch {
    throw new Error("wrong passphrase, or the file was modified");
  }
  const o = JSON.parse(new TextDecoder().decode(plain)) as EngagementOpening;
  if (o.commitments.walletCommit !== file.hint.walletCommit || o.commitments.termsCommit !== file.hint.termsCommit) {
    throw new Error("file contents do not match its commitments");
  }
  await verifyOpening(o);
  return o;
}
