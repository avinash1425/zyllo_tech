export default function ResultCard({ label, value, accent = "#1f4693", size = "md" }) {
  const sizeClass = size === "lg" ? "text-3xl sm:text-4xl" : "text-2xl";
  return (
    <div className="rounded-2xl border border-[#dde3ea] bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">{label}</p>
      <p className={`mt-1.5 font-bold ${sizeClass}`} style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
