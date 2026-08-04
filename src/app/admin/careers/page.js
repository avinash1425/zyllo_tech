"use client";

import { useState } from "react";
import { Plus, MapPin, Pencil, Trash2, Users } from "lucide-react";

const POSITIONS = [
  {
    id: 1,
    title: "Senior Full-Stack Engineer",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
    status: "Open",
    applicants: 14,
  },
  {
    id: 2,
    title: "Product Designer (UI/UX)",
    department: "Design",
    location: "Remote / India",
    type: "Full-time",
    status: "Open",
    applicants: 9,
  },
  {
    id: 3,
    title: "Mobile Engineer (React Native)",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
    status: "Open",
    applicants: 6,
  },
  {
    id: 4,
    title: "QA & Automation Engineer",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
    status: "Open",
    applicants: 5,
  },
  {
    id: 5,
    title: "DevOps Engineer",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
    status: "Open",
    applicants: 3,
  },
  {
    id: 6,
    title: "Marketing Associate",
    department: "Marketing",
    location: "Remote / India",
    type: "Part-time",
    status: "Closed",
    applicants: 21,
  },
];

const STATUS_STYLES = {
  Open: "bg-[#3b6d11]/10 text-[#3b6d11]",
  Closed: "bg-[#676b7a]/10 text-[#676b7a]",
};

export default function AdminCareersPage() {
  const [positions] = useState(POSITIONS);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Careers</h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            {positions.filter((p) => p.status === "Open").length} open positions,{" "}
            {positions.reduce((sum, p) => sum + p.applicants, 0)} total applicants.
          </p>
        </div>

        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Position
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {positions.map((position) => (
          <div
            key={position.id}
            className="group relative flex flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm transition-all duration-300 hover:border-transparent hover:shadow-lg hover:shadow-[#f7941e]/10 sm:flex-row sm:items-center"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1 scale-y-0 bg-gradient-to-b from-[#f7941e] to-[#1f4693] transition-transform duration-300 group-hover:scale-y-100"
            />

            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-base font-semibold text-[#2b303b]">{position.title}</h3>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[position.status]}`}
                >
                  {position.status}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#676b7a]">
                <span className="font-medium text-[#f7941e]">{position.department}</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {position.location}
                </span>
                <span>{position.type}</span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {position.applicants} applicants
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                aria-label={`Edit ${position.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${position.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
