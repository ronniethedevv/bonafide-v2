#!/usr/bin/env node
// Make sure the compiled epoch_proof contract (its generated JS, no proving keys) exists
// before `next build`: the live engagement pages decode the contract's public state with
// its generated `ledger()`. CI and local builds compile it already; on a host without the
// Compact compiler (Vercel) this downloads the pinned compactc release, checks its
// SHA-256, unpacks it with Node's zlib and compiles with --skip-zk (a few seconds).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const VERSION = "0.36.1";
const URL_ZIP = `https://github.com/midnightntwrk/compact/releases/download/compactc-v${VERSION}/compactc_v${VERSION}_x86_64-unknown-linux-musl.zip`;
const SHA256 = "9d5fedfec9ae775a1e47d5c6f785130b314c1c5c52cd1a4eb9fc56d1fc61d23a";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const contracts = join(root, "packages/contracts");
const out = join(contracts, "dist/epoch_proof");
const log = (m) => process.stdout.write(`[contract] ${m}\n`);

if (existsSync(join(out, "contract/index.js"))) {
  log("compiled contract present");
  process.exit(0);
}

/** The entries of a zip archive (central directory), inflated on demand. */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported zip method ${method}`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

log(`compiling with compactc ${VERSION}`);
const res = await fetch(URL_ZIP);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const digest = createHash("sha256").update(zip).digest("hex");
if (digest !== SHA256) throw new Error(`compactc archive checksum mismatch: ${digest}`);
const dir = mkdtempSync(join(tmpdir(), "compactc-"));
const entries = unzip(zip);
for (const name of ["compactc", "compactc.bin"]) {
  const read = entries.get(name);
  if (!read) throw new Error(`${name} missing from the archive`);
  writeFileSync(join(dir, name), read());
  chmodSync(join(dir, name), 0o755);
}
mkdirSync(join(contracts, "dist"), { recursive: true });
execFileSync(join(dir, "compactc"), ["--skip-zk", join(contracts, "src/epoch_proof.compact"), out], { stdio: "inherit" });
log(`compiled to ${out}`);
