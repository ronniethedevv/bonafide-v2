# How to use BonaFide v2 as a client

You are a token project hiring a market maker. BonaFide v2 lets you check, before you accept and
before you send anything, that the market maker's terms are the ones it committed to, that its
bond pays you if it defaults and that it controls the wallets it names. Then you follow each day
on Midnight. Everything here happens in the browser; you need no terminal.

The live site runs on Midnight's Preview testnet: the bond is a test token, not real money.

## What you need

- An Ethereum wallet to sign in: a browser wallet, or any wallet through WalletConnect. Signing in
  is a signature, not a transaction, and costs nothing.
- A Midnight wallet such as [Lace](https://www.lace.io/), set to Preview. You only copy its
  shielded address; the site never connects to it.

## 1. Sign in and set up your account

1. Open [bonafide-v2.vercel.app](https://bonafide-v2.vercel.app) and choose **Sign in**.
2. Connect your wallet and sign the sign-in message.
3. Under **Which are you?**, choose **I hire market makers**, then pick a handle. Your name is only
   shown to the market makers you work with.

You land on **My engagements**, your client portal.

## 2. Save your Midnight key

Under **Your Midnight key for bonds**, paste the shielded address Lace shows
(`mn_shield-addr_preview1…`) and choose **Save**. The site keeps only its coin public key, the part
that receives coins.

If the market maker defaults, its bond is paid to this key. Market makers register with the key
you save here, and the portal refuses an engagement that names any other key.

## 3. Set up your private inbox

Choose **Set up inbox** and sign the message your wallet shows. The signature creates the key that
decrypts what market makers send you. It is created in your browser and never sent anywhere.

## 4. Tell the market maker who you are

Give the market maker the address of the wallet you signed in with. It enters it as **Client's
sign-in wallet** when it registers the engagement, and its terms are encrypted to your inbox.

## 5. Review the proposal

When a proposal arrives it appears in your portal. Choose **Open the terms**: they are decrypted
here in your browser. The portal then checks three things and shows each result:

| Check | What it means |
|---|---|
| The terms match the commitments | These are exactly the terms the market maker committed to on chain. If not, the portal says so; don't accept. |
| The bond names your Midnight key | On a default, the bond is paid to you. |
| Every trading wallet signed for this engagement | The market maker controls each wallet it named. Smart-contract wallets are checked too. |

Choose **Accept and sign** only when all three pass. Accepting is a signature, not a transaction.
Choose **Decline** otherwise.

## 6. Before you send the loan

Once the market maker has registered and posted its bond on Midnight, choose **Check on Midnight**.
The portal finds the engagement on chain by the commitments you accepted and checks the bond, who
receives it, the tier and the clock.

- **Safe to fund:** the engagement on chain is the one you accepted, and the bond is held. Send the
  loan to the market maker's wallets as agreed; BonaFide v2 never moves your funds.
- **Don't send the loan yet:** something differs, and the portal says what.
- **Safe, and funded:** later, once the market maker has proven the loan reached its wallets.

## 7. Follow the engagement

Choose **Follow it on Midnight** to open the engagement's live page. It reads the contract on every
visit and shows, for each of the 30 days, the attested root, the uptime proven in zero knowledge,
the settlement and the release of that day's share of the bond. Anyone can open it; only the
outcomes are public, never the wallets or the terms.

**Open daily figures** shows each day's figures the market maker shares with you, encrypted to your
inbox. In this preview the market maker's agent sends them from replayed data; the proven outcome
for each day is on the live page.

## If the market maker defaults

If a day's root was attested and the market maker did not prove and settle that day before its
deadline (66 hours after the day ends), anyone can declare the engagement in default on Midnight,
and the whole bond the contract still holds is paid to your Midnight key. A day whose root was
never attested, or was disputed, never counts against the market maker. There is no button for
declaring a default on the site yet; see [Scope and limits](../README.md#scope-and-limits).
