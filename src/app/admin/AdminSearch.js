"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  FileText,
  User,
  Newspaper,
  FolderKanban,
  Mail,
  LayoutDashboard,
} from "lucide-react";

const TYPE_ICON = {
  Applicant: User,
  "Blog Post": Newspaper,
  "Portfolio Project": FolderKanban,
  "Contact Submission": Mail,
  Section: LayoutDashboard,
};

export default function AdminSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  function goTo(href) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  async function handleKeyDown(e) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key !== "Enter") return;
    e.preventDefault();

    if (results.length > 0) {
      goTo(results[0].href);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    // Results may not have loaded yet (debounce hasn't fired). Fetch
    // immediately so Enter works even right after typing.
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      const fresh = data.results || [];
      setResults(fresh);
      if (fresh.length > 0) {
        goTo(fresh[0].href);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full sm:max-w-sm sm:flex-1">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]/50"
        aria-hidden="true"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search everything…"
        className="w-full rounded-lg border border-[#e7e9ee] bg-[#fafbfc] py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#1f4693]/50 focus:bg-white"
      />

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-xl border border-[#e7e9ee] bg-white shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-[#676b7a]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Searching…
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-[#676b7a]">
              No matches for &ldquo;{query.trim()}&rdquo;.
            </div>
          )}

          {!loading &&
            results.map((result, i) => {
              const Icon = TYPE_ICON[result.type] || FileText;
              return (
                <button
                  key={`${result.type}-${result.title}-${i}`}
                  type="button"
                  onClick={() => goTo(result.href)}
                  className="flex w-full items-start gap-3 border-b border-[#f0f1f4] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[#fafbfc]"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#1f4693]" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#2b303b]">{result.title}</p>
                    {result.subtitle && (
                      <p className="truncate text-xs text-[#676b7a]">{result.subtitle}</p>
                    )}
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1f4693]/70">
                      {result.type}
                    </p>
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
