# Short Discord / support-channel post

Paste this into the Midnight dev-support or hackathon support channel, then attach
`specs/SERVICEDESK_REPORT.md` or link to it on GitHub. Keep it short; tables do not render
well in Discord.

---

Hey, flagging a reproducible Preview testnet issue.

**Problem:** contract **calls** we submit to Preview never get included in a block. **Deploys**
and maintenance updates from the same wallet and client land fine. Only calls fail.

Two symptoms, same root cause caught at two different checks:
- `register(...)` → `1010 Invalid Transaction: Custom error: 117` (NotNormalized), instantly at mempool.
- a vanilla one-circuit counter `increment()` → no error at all, admitted to the mempool, then never included (the client just hangs).

**Key finding:** the exact same call **works on a local node** built from the identical
version (`system_version 1.0.400-87c0fbdb`, `midnight_ledgerVersion =8.1.3`, same client
checkout). So it is Preview-specific, not our code. We ruled out the ledger version, the 8.1.3
call-transcript rules, our dependency setup, the compiler/ZKIR, and the batched deploy. All
clear, because the same thing succeeds locally.

**Best guess:** our Preview wallet got DUST via **registration**; the local genesis wallet has
it natively. There is a prior fix for exactly this shape: `midnight-node#758` "omit
`DustActions` if it's a No-op, resolves NotNormalized."

**The one thing we can't get ourselves:** a dropped `increment` returns no code, so we never
learn its tx hash. Could someone check a Preview producer's pre-dispatch log for the reason?
The full write-up has the submitter address, timestamps, and contract addresses to find them.

Client: midnight-js 4.1.1 / ledger-v8 8.1.0 / onchain-runtime-v3 3.1.2 / compact-runtime 0.16.0,
Compact 0.31.1, proof-server 8.1.3. Full report (tx hashes, versions, repro steps, 4
questions) attached.
