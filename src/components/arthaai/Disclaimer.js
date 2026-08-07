export default function Disclaimer({ compact = false }) {
  if (compact) {
    return (
      <p className="text-xs leading-relaxed text-[#6b7280]">
        ArthaAI is a financial education platform, not a registered
        investment or tax adviser. Figures are estimates for educational
        purposes only and do not constitute financial advice.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[#f0d9a8] bg-[#fdf6e8] p-4">
      <p className="text-xs leading-relaxed text-[#7a5c1e]">
        <span className="font-semibold">Educational estimate, not financial advice.</span>{" "}
        ArthaAI is a financial education platform, not a registered
        investment or tax adviser. This calculator uses standard financial
        formulas and reference rates that may not reflect your actual
        returns, loan terms, or tax outcome. Interest rates, tax rules, and
        deposit terms vary by country and change over time — always verify
        current rates and rules with your bank, employer, tax authority, or
        a qualified professional before making a financial decision. Past
        performance is not indicative of future results.
      </p>
    </div>
  );
}
