"use client";

import { useState } from "react";
import DateRangeSelect from "./DateRangeSelect";
import TopPagesDonut from "./TopPagesDonut";

export default function TopPagesPanel() {
  const [days, setDays] = useState(30);

  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#2b303b]">
          Top Performing Pages (by Traffic)
        </h2>
        <DateRangeSelect value={days} onChange={setDays} />
      </div>

      <div className="mt-3">
        <TopPagesDonut days={days} />
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[#676b7a]/70">
        Sample data — connect an analytics tool to show real page performance here.
      </p>
    </div>
  );
}
