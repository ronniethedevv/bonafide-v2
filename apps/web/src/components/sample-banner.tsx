import { Info } from "@/components/icons";

const TEXT = {
  directory:
    "These market makers and their records are illustrative, not real firms or real trading. Real records appear here as engagements complete.",
  account:
    "This demo account's engagements are illustrative. The figures come from running our real checks on generated activity, not on real trading.",
} as const;

/** Marks pages that show demo or fixture data, so nothing illustrative passes for real. */
export function SampleDataBanner({ kind }: { kind: keyof typeof TEXT }) {
  return (
    <div className="sample-banner" role="note">
      <Info size={15} style={{ marginTop: 2 }} />
      <span>
        <strong>Sample data.</strong> {TEXT[kind]}
      </span>
    </div>
  );
}
