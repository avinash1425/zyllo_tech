
import { useState } from "react";
import DateRangeSelect from "./DateRangeSelect";
import SamplePill from "./SamplePill";
import TopPagesDonut from "./TopPagesDonut";

export default function TopPagesPanel() {
  const [days, setDays] = useState(30);

  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2b303b]">
            Top Performing Pages (by Traffic)
          </h2>
          <SamplePill />
        </div>
        <DateRangeSelect value={days} onChange={setDays} />
      </div>

      <div className="mt-3">
        <TopPagesDonut days={days} />
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[#676b7a]">
        Sample data — connect an analytics tool to show real page performance here.
      </p>
    </div>
  );
}
