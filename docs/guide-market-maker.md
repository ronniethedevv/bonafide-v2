# How to use BonaFide v2 as a market maker

You run liquidity for a token project and want a track record you can prove without showing your
wallets, balances or strategy. You set up an engagement with your client in the browser, then
prove each day on Midnight from your own machine, so your keys and private data never leave it.
At the end you add the engagement to your public record.

The live site runs on Midnight's Preview testnet: the bond is a test token, and Midnight fees are
paid in tDUST from the faucet.

| Part | Where | What |
|---|---|---|
| [1. Set up](#1-set-up-in-the-browser) | browser | Sign in; your client sets up its account |
| [2. Propose the engagement](#2-propose-the-engagement) | browser, or your machine | Terms, wallets, bond; each wallet signs; the client accepts |
| [3. Prepare your machine](#3-prepare-your-machine-once) | terminal, once | The repository, the circuits, a proof server, a funded Midnight wallet |
| [4. Register, bond, activate](#4-register-bond-and-activate) | terminal | Three Midnight transactions |
| [5. Every day](#5-every-day) | terminal, scheduled | Funding, then each day's proof, settlement and release |
| [6. Claim](#6-claim-it-into-your-public-record) | terminal | Add the engagement to your public record |

## 1. Set up in the browser

1. Open [bonafide-v2.vercel.app](https://bonafide-v2.vercel.app), choose **Sign in** and sign the
   sign-in message with an Ethereum wallet (a signature, not a transaction).
2. Under **Which are you?**, choose **I'm a market maker** and pick your public handle.
3. Ask your client to follow [the client guide](guide-client.md) up to step 3 (save its Midnight
   key, set up its inbox) and to send you the address of the wallet it signs in with. Your proposal
   is encrypted to its inbox, and the bond is registered to its key.

## 2. Propose the engagement

There are two ways. The wizard needs no terminal. The agent keeps your trading wallets off the
website entirely.

### In the browser: the wizard

In your **Workspace**, choose **New engagement**. The wizard has five steps:

| Step | What you enter |
|---|---|
| Deal | The pool, your client's sign-in wallet, a private label, the loan |
| KPI terms | Depth target per side, depth band, minimum uptime; optional caps (round trips, outflow, net selling) and a floor price |
| Wallets | The trading wallets you quote from |
| Bond | The tier and the bond amount. Your client's Midnight key is filled in from its account |
| Review | Prove you control each wallet, save the encrypted file, register |

On **Review**:

1. Under **Prove you control each wallet**, choose **Sign with this wallet** for each one, or paste
   a signature made elsewhere (a custody platform can sign the message under a signing policy). It
   is a signature, not a transaction.
2. Choose a passphrase and **Download encrypted file**. The file holds the secret values behind your
   commitments: without it and its passphrase this engagement can never be proven, and nobody can
   recover it for you.
3. Choose **Register engagement**. Your client receives the terms, encrypted to its inbox; only two
   commitments are stored in the clear.

### On your machine: the agent

In your **Workspace**, choose **Connect agent**, then **New token**, and copy the command it shows.
After [preparing your machine](#3-prepare-your-machine-once):

```bash
pnpm --filter @mmr/agent agent connect --server https://bonafide-v2.vercel.app --token <agent token>
pnpm --filter @mmr/agent agent create --client 0x<client's sign-in wallet> --pool 0x529d2863a1521d0b57db028168fde2e97120017c \
  --pair VIRTUAL/USDC --wallets 0x…,0x… --terms terms.json --tier 1 --bond 10000 --out engagement.mmr.json
```

`create` writes `engagement.mmr.json.ownership.json`, with the message each wallet must sign. Have
each wallet sign its message, fill in its `signature` in that file, then propose:

```bash
pnpm --filter @mmr/agent agent propose engagement.mmr.json --signatures engagement.mmr.json.ownership.json
```

`terms.json` states the terms in the contract's units (token base units; uptime in half-hour
buckets out of 48 a day). This example is a 100,000 VIRTUAL loan with 2,500 USDC of depth per side
within 2% of the price in 36 of 48 half-hours, round trips under 5% of volume and outflow capped at
the loan; the agent adds the pool from `--pool`:

```json
{
  "floorPriceP": "0",
  "loanL0": "100000000000000000000000",
  "quoteStartQ0": "0",
  "disposalD": "100000000000000000000000",
  "netSellS": "0",
  "depthTarget": "2500000000",
  "roundtripSharePpm": "50000",
  "bandBps": "200",
  "minUptimeBuckets": "36",
  "epochsTotal": "30"
}
```

### Your client accepts

Your client opens the terms in its portal, sees them checked against your commitments, its key and
your wallet signatures, and accepts. Then the Midnight steps start.

## 3. Prepare your machine (once)

You need Node.js 22 or later, pnpm 10, Docker and the
[Compact compiler](https://docs.midnight.network/getting-started/installation) 0.36.1.

```bash
git clone https://github.com/ronniethedevv/bonafide-v2.git && cd bonafide-v2
pnpm install
pnpm --filter @mmr/contracts compact:build      # the circuits and proving keys, about 4 minutes
pnpm --filter @mmr/dapp proof-server            # in its own terminal; proofs are made here, on your machine
```

Your Midnight wallet is a 32-byte seed. Keep it like any private key; never put it in a repository.

```bash
export MM_SEED=$(openssl rand -hex 32)          # or your existing seed
export MMR_ENGAGEMENT_PASSPHRASE='…'           # the engagement file's passphrase
pnpm --filter @mmr/dapp run register-dust       # prints your address; fund it with tNIGHT
```

Request tNIGHT for the printed address at the [Preview faucet](https://faucet.preview.midnight.network/),
then run `register-dust` again: it registers the tNIGHT to generate tDUST, which pays every fee.

## 4. Register, bond and activate

Use the engagement file the wizard downloaded or the agent created.

```bash
pnpm --filter @mmr/dapp mm register engagement.mmr.json   # commitments, tier, bond size, your client's key
pnpm --filter @mmr/dapp mm bond engagement.mmr.json       # the contract holds the bond
```

On Preview, `register` mints test bond tokens first if your wallet holds too few. Tell your client
the bond is posted: its **Check on Midnight** confirms the engagement on chain is the one it
accepted before it sends the loan. Then start the clock; day 1 is the next UTC day:

```bash
pnpm --filter @mmr/dapp mm activate engagement.mmr.json
```

Activate within 72 hours of registering: after that, anyone can void an engagement that was never
activated, which returns your bond. To void it yourself:

```bash
pnpm --filter @mmr/dapp mm void engagement.mmr.json
```

## 5. Every day

```bash
pnpm --filter @mmr/dapp mm run engagement.mmr.json
```

`run` reads the contract and does whatever is due: the funding proof once, then for each ended day
its proof, its settlement and, once the day's dispute window has closed, the release of that day's
share of the bond. It does nothing when nothing is due, so schedule it every few hours, for example
with cron, keeping `MM_SEED` and `MMR_ENGAGEMENT_PASSPHRASE` in a file only you can read.

Each day's root is attested after the daily index (from 01:10 UTC). A day must be proven and
settled within 66 hours of its end; a missed day lets anyone declare a default, and the bond goes to
your client. A day whose root was never attested, or was disputed, never counts against you.

At any time:

```bash
pnpm --filter @mmr/dapp mm status engagement.mmr.json
```

Every transaction is recorded next to the file, in `engagement.mmr-lifecycle.json` (public data
only), and the engagement's live page shows each day on chain.

## 6. Claim it into your public record

After the last day is released:

```bash
pnpm --filter @mmr/dapp mm claim engagement.mmr.json   # once; adds the credited days to your record
pnpm --filter @mmr/dapp mm profile                     # your profile id
```

Share `https://bonafide-v2.vercel.app/record/<profile id>`: it reads your record from the contract,
per tier, and nothing in it links back to the engagement or your client.
