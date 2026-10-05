/** Small pill marking a card whose figures are placeholder/sample data. */
export default function SamplePill({ className = "" }) {
  return (
    <span
      title="Placeholder figures - not real analytics"
      className={`inline-flex items-center rounded-full bg-[#676b7a]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#4b4f5c] ring-1 ring-inset ring-[#676b7a]/25 ${className}`}
    >
      Sample
    </span>
  );
}
