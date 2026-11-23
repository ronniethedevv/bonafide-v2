// The bond's beneficiary: the client's Midnight coin public key. The contract fixes it at
// registration and makes it public so the client can check it; a market maker naming its
// own key would collect its own slashed bond. The client saves its key on its account,
// and acceptance is allowed only when the registration names that key.

import type { ClientTermsPayload } from "./terms";

/** A Midnight coin public key: 32 bytes, as lowercase hex without 0x, not all zero. */
export function normalizeMidnightKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const k = v.trim().replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(k) && !/^0+$/.test(k) ? k : null;
}

export type BeneficiaryCheck = { ok: true } | { ok: false; reason: string };

/** Does the proposal's on-chain registration name `clientKey` as the bond's beneficiary? */
export function checkBeneficiary(payload: Pick<ClientTermsPayload, "registration">, clientKey: string | null): BeneficiaryCheck {
  const reg = payload.registration;
  const mine = normalizeMidnightKey(clientKey);
  if (!mine) return { ok: false, reason: "Save your Midnight key above first: the bond must name it." };
  if (!reg) {
    return { ok: false, reason: "This proposal does not state its on-chain registration (tier, bond, your key). Don't accept; ask the market maker to register again." };
  }
  if (normalizeMidnightKey(reg.beneficiary) !== mine) {
    return { ok: false, reason: "The bond names a different Midnight key, not yours: on a default it would not reach you. Don't accept." };
  }
  return { ok: true };
}
