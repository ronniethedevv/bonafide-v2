# Midnight setup guide (Ubuntu)

This is everything needed to take the project from "TS core, all tested" to
compiling the Compact circuits, running proofs, and wiring the live data sources.
It targets **Ubuntu** (native or WSL2 on Windows).

> Fast-moving: Midnight's toolchain and endpoints change often. Where a step says
> **[verify]**, copy the exact command/URL from the linked official page rather
> than trusting a value here. Primary sources are listed at the bottom.

---

## 0. Which Ubuntu are you on?

- **WSL2 (Ubuntu on Windows):** do everything *inside* the Ubuntu shell. Your
  desktop project is probably at `/mnt/c/Users/<you>/Desktop/mm-reputation`
  (the Windows Desktop, seen from Ubuntu). Install **Docker Desktop for Windows**
  and enable *Settings → Resources → WSL integration* for your Ubuntu distro —
  that gives you `docker` inside Ubuntu, which the proof server needs.
- **Native Ubuntu:** project at `~/Desktop/mm-reputation`; install Docker Engine
  the normal Linux way.

Find your project and `cd` into it:

```bash
cd ~/Desktop/mm-reputation 2>/dev/null || cd /mnt/c/Users/$USER/Desktop/mm-reputation
pwd   # confirm you're in the repo (should contain pnpm-workspace.yaml)
```

---

## 1. Base prerequisites

You already have Node 22 + pnpm from running the project. Add the rest:

```bash
sudo apt update
sudo apt install -y curl git build-essential
node -v        # expect v22.x
pnpm -v
docker --version   # must work inside Ubuntu (WSL: via Docker Desktop integration)
```

---

## 2. Install the Compact toolchain

The toolchain installs in two stages: a one-time `compact` CLI, then a pinned
compiler version.

1. **Install the `compact` CLI.** Copy the exact `curl … | sh` installer line
   from the official install page **[verify]** and run it:
   - Page: https://docs.midnight.network/getting-started/installation
   - Releases (for the version matrix): https://github.com/midnightntwrk/compact/releases

2. **Add it to PATH** (if the shell can't find `compact` after reopening):
   ```bash
   echo 'export PATH="$HOME/.compact/bin:$PATH"' >> ~/.bashrc   # [verify] exact path from installer output
   source ~/.bashrc
   ```

3. **Pin the compiler to the ledger-8 / mainnet-compatible line.** This project
   targets **Compact 0.31.x** (ledger 8). Do NOT run a bare `compact update` —
   that pulls the newest release (0.35.x / ledger 9), which mainnet doesn't run yet.
   ```bash
   compact update 0.31.1       # [verify] latest 0.31.x on the releases page
   ```

4. **Verify:**
   ```bash
   compact --version
   compact compile --version
   which compact
   ```

---

## 3. Proof server (local)

Generating proofs needs a local proof server. The official install guide has a
separate proof-server step — usually a Docker image **[verify exact image + port]**:

```bash
# shape only — copy the exact image tag/port from the install guide
docker run -d --name midnight-proof-server -p 6300:6300 <proof-server-image>
curl -s http://localhost:6300/health   # sanity check [verify path/port]
```

Keep this running whenever you compile/prove.

---

## 4. Accounts, keys, and test funds

Start on **preview** (no token, simplest) to get the first compile + proof working,
then move to preprod/mainnet.

| What | Where | Needed for |
|------|-------|-----------|
| Midnight wallet + address | Midnight wallet / Lace for Midnight **[verify]** | deploying, paying DUST fees |
| Test NIGHT (tNIGHT) | preprod faucet **[verify URL]** (Nethermind / Google Cloud Web3 portal) | testnet gas |
| Blockfrost project token | https://blockfrost.io → new **Midnight** project | preprod + mainnet RPC/indexer (one token per network; not interchangeable) |
| Base archive RPC key | Alchemy / QuickNode / Infura (archive on **Base**) | the deterministic indexer's data source |
| IPFS pinning key | Pinata or web3.storage | publishing Merkle trees so anyone can recompute roots |

Network endpoints (as of the latest release notes) **[verify on the networks page]**:

- **preview** — Midnight-hosted, **no token**. Node RPC `https://rpc.preview.midnight.network`.
- **preprod** — moved to **Blockfrost** (Midnight-hosted preprod retired 9 Oct 2026). Needs a preprod Blockfrost token.
- **mainnet** — **Blockfrost** only (Midnight-hosted mainnet retired 30 Sep 2026). Needs a mainnet Blockfrost token. Faucet: none.

Networks page: https://docs.midnight.network/guides/networks-and-environments

---

## 5. Put the keys in `.env` (never commit)

Copy the template and fill it in. `.gitignore` already blocks `.env*`.

```bash
cp .env.example .env
# edit .env with your editor and paste in the values
```

---

## 6. Compile the circuits

```bash
cd packages/contracts
compact compile src/epoch_proof.compact  build/epoch_proof   # the one contract (DD-17)
```

The compiler is the first real check of circuit syntax and semantics against
0.31.x; resolving anything it reports is part of this step.

---

## 7. What happens after you have all this

Once the toolchain compiles and the keys are in `.env`, the remaining work (which
I can drive) is:

1. Fix the circuits until `compact compile` passes for all four.
2. Run the **proving benchmark** (16-slot epoch circuit) → measure proving time,
   then fix bucket sizes (currently 48 buckets/epoch is a placeholder).
3. Implement **real Jubjub Schnorr attester signing** behind the existing
   `AttesterCommittee` interface (replaces the mock in `@mmr/protocol`).
4. Implement the live **Base `ChainProvider`** (archive RPC) and **IPFS
   `TreePublisher`** behind the interfaces `@mmr/indexer` already defines.
5. Deploy to **preview → preprod**, run an end-to-end epoch, then pilot.

Everything in steps 3–4 plugs into interfaces that already exist and are tested
against in-memory fakes, so this is wiring, not redesign.

---

## Sources (verify before relying on any command)

- Install the toolchain — https://docs.midnight.network/getting-started/installation
- Compact releases / version matrix — https://github.com/midnightntwrk/compact/releases
- Compact compiler relnotes — https://docs.midnight.network/relnotes/compact
- Networks and environments — https://docs.midnight.network/guides/networks-and-environments
- Blockfrost — https://blockfrost.io
