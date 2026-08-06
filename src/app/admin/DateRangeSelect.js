"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Calendar } from "lucide-react";

const RANGES = [
  { label: "Last 7 Days", days: 7 },
  { label: "Last 30 Days", days: 30 },
  { label: "Last 90 Days", days: 90 },
];

export default function DateRangeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const current = RANGES.find((r) => r.days === value) ?? RANGES[1];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e9ee] bg-[#fafbfc] px-3 py-1.5 text-xs font-medium text-[#676b7a] transition-colors hover:border-[#f7941e]/40 hover:text-[#2b303b]"
      >
        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
        {current.label}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-40 overflow-hidden rounded-lg border border-[#e7e9ee] bg-white shadow-lg">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => {
                onChange(range.days);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                range.days === value
                  ? "bg-[#f7941e]/10 text-[#f7941e]"
                  : "text-[#676b7a] hover:bg-[#fafbfc] hover:text-[#2b303b]"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
