"use client";

export default function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  helpText,
  useCurrencyPrefix = false,
}) {
  const resolvedPrefix = useCurrencyPrefix ? "₹" : prefix;
  const numberLocale = "en-IN";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-[#1c2333]">{label}</label>
        <span className="text-sm font-semibold text-[#1f4693]">
          {resolvedPrefix}
          {typeof value === "number" ? value.toLocaleString(numberLocale) : value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="arthaai-slider w-full"
      />
      <div className="mt-2 flex items-center gap-2">
        {resolvedPrefix && <span className="text-sm text-[#6b7280]">{resolvedPrefix}</span>}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm text-[#1c2333] outline-none focus:border-[#1f4693]/60"
        />
        {suffix && <span className="text-sm text-[#6b7280]">{suffix}</span>}
      </div>
      {helpText && <p className="mt-1.5 text-xs text-[#6b7280]">{helpText}</p>}

      <style jsx>{`
        .arthaai-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 999px;
          background: #e3e8ee;
          outline: none;
        }
        .arthaai-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #1f4693;
          cursor: pointer;
          border: 3px solid white;
          box-shadow: 0 1px 4px rgba(31, 70, 147, 0.4);
        }
        .arthaai-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #1f4693;
          cursor: pointer;
          border: 3px solid white;
          box-shadow: 0 1px 4px rgba(31, 70, 147, 0.4);
        }
      `}</style>
    </div>
  );
}
