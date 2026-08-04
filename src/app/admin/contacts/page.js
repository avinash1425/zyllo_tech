"use client";

import { useState } from "react";
import { Search, Mail, Phone, Trash2, Eye } from "lucide-react";

const SUBMISSIONS = [
  {
    id: 1,
    name: "Ravi Kumar",
    email: "ravi.kumar@example.com",
    phone: "+91 98765 43210",
    company: "Nimbus Retail",
    service: "Web Development",
    message: "Looking to rebuild our e-commerce storefront with better checkout flow.",
    status: "New",
    date: "2026-08-03",
  },
  {
    id: 2,
    name: "Priya Sharma",
    email: "priya.sharma@example.com",
    phone: "+91 91234 56789",
    company: "Carevia Health",
    service: "AI Solutions",
    message: "Need an AI-assisted triage tool for our telehealth platform.",
    status: "New",
    date: "2026-08-03",
  },
  {
    id: 3,
    name: "James Whitfield",
    email: "james.w@example.com",
    phone: "+1 415 555 0192",
    company: "Northfield Capital",
    service: "Cybersecurity Engineering",
    message: "Requesting a security review ahead of our SOC 2 audit.",
    status: "Contacted",
    date: "2026-08-01",
  },
  {
    id: 4,
    name: "Ananya Iyer",
    email: "ananya.iyer@example.com",
    phone: "+91 90000 11223",
    company: "Freelance",
    service: "Mobile App Development",
    message: "Want a quote for a cross-platform fitness tracking app.",
    status: "Contacted",
    date: "2026-07-30",
  },
  {
    id: 5,
    name: "Daniel Osei",
    email: "daniel.osei@example.com",
    phone: "+233 24 555 0101",
    company: "Voltra Logistics",
    service: "Cloud Solutions",
    message: "Migrating our fleet tracking backend to a scalable cloud setup.",
    status: "Closed",
    date: "2026-07-27",
  },
  {
    id: 6,
    name: "Meera Nair",
    email: "meera.nair@example.com",
    phone: "+91 98111 22334",
    company: "EduSpark",
    service: "UI/UX Design",
    message: "Redesigning our student portal for better accessibility.",
    status: "Closed",
    date: "2026-07-22",
  },
];

const STATUS_STYLES = {
  New: "bg-[#f7941e]/10 text-[#f7941e]",
  Contacted: "bg-[#1f4693]/10 text-[#1f4693]",
  Closed: "bg-[#3b6d11]/10 text-[#3b6d11]",
};

const FILTERS = ["All", "New", "Contacted", "Closed"];

export default function AdminContactsPage() {
  const [activeFilter, setActiveFilter] = useState("All");
  const [query, setQuery] = useState("");

  const filtered = SUBMISSIONS.filter((item) => {
    const matchesFilter = activeFilter === "All" || item.status === activeFilter;
    const matchesQuery =
      query.trim() === "" ||
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      item.company.toLowerCase().includes(query.toLowerCase()) ||
      item.service.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">
            Contact Submissions
          </h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            {SUBMISSIONS.length} total submissions from the site contact form.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]/50"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search submissions…"
            className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#f7941e]/50"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setActiveFilter(filter)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
              activeFilter === filter
                ? "border-transparent bg-[#0b0e17] text-white"
                : "border-[#e7e9ee] bg-white text-[#676b7a] hover:border-[#f7941e]/40 hover:text-[#f7941e]"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7e9ee] bg-[#fafbfc] text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Service</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[#e7e9ee] last:border-0 transition-colors hover:bg-[#fafbfc]"
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold text-[#2b303b]">{item.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-[#676b7a]">
                      <Mail className="h-3 w-3" aria-hidden="true" />
                      {item.email}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-[#676b7a]">
                      <Phone className="h-3 w-3" aria-hidden="true" />
                      {item.phone}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-[#2b303b]">{item.company}</td>
                  <td className="px-5 py-4 text-[#676b7a]">{item.service}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[item.status]}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-[#676b7a]">{item.date}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`View submission from ${item.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete submission from ${item.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[#676b7a]">
            No submissions match your search.
          </div>
        )}
      </div>
    </div>
  );
}
