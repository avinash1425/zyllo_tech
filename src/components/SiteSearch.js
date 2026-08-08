"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, X, Loader2, FileText, Briefcase, Layers, Newspaper } from "lucide-react";

const TYPE_ICON = {
  Page: FileText,
  Service: Layers,
  "Blog Post": Newspaper,
  "Open Role": Briefcase,
};

// Suggestions shown as clickable chips before the user types anything.
// Picked to cover the most common things people come looking for.
const SUGGESTED_QUERIES = [
  "What services do you offer?",
  "Mobile app development",
  "Careers",
  "Contact us",
];

// Site-wide public search, styled as a centered modal ("AI Search"-style
// card: title row, big input + Search button, suggestion chips, results
// list). Despite the look, this is plain keyword search over site
// content — not an AI assistant — backed by /api/search (see that route
// for what's indexed: static pages, services, and live Supabase blog
// posts / open job postings).
export default function SiteSearch({ variant = "desktop" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef(null);
  const router = useRouter();

  // The modal is portaled to document.body (see the createPortal call
  // below) so its `fixed` overlay isn't trapped inside the header, which
  // uses backdrop-blur — any backdrop-filter/filter/transform ancestor
  // creates a new containing block that hijacks `position: fixed`
  // descendants, making the overlay appear "attached" to the header
  // instead of covering the full viewport. document.body only exists on
  // the client, so we gate the portal on this mount flag.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        setResults(data.results || []);
        setActiveIndex(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
        setHasSearched(true);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [query]);

  function openSearch() {
    setIsOpen(true);
  }

  function closeSearch() {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setHasSearched(false);
  }

  function goTo(href) {
    closeSearch();
    router.push(href);
  }

  function askQuery(text) {
    setQuery(text);
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      closeSearch();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target) goTo(target.href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search Zyllo Tech"
        className={
          variant === "mobile-menu-item"
            ? "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm font-medium text-[#2b303b] transition-colors hover:bg-neutral-100 hover:text-[#f7941e]"
            : "inline-flex h-9 w-9 items-center justify-center rounded-full text-[#2b303b] transition-colors duration-200 hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
        }
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        {variant === "mobile-menu-item" && "Search"}
      </button>

      {mounted &&
        isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[#0b1220]/70 px-4 py-6 backdrop-blur-sm sm:items-center sm:py-10"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeSearch();
            }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#f0f1f4] px-6 py-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-white shadow-sm">
                  <Search className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-base font-bold text-[#2b303b]">Search Zyllo Tech</p>
                  <p className="mt-0.5 text-sm text-[#676b7a]">
                    Find services, pages, blog posts, and open roles.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="shrink-0 rounded-full p-1.5 text-[#676b7a] transition-colors hover:bg-neutral-100 hover:text-[#2b303b]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="px-6 pt-5">
              <div className="flex items-center gap-2 rounded-full border-2 border-[#a8d4f0] bg-white px-2 py-2 shadow-sm transition-colors focus-within:border-[#f7941e]">
                <Search className="ml-2 h-4 w-4 shrink-0 text-[#676b7a]/60" aria-hidden="true" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search anything about Zyllo Tech…"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 sm:text-base"
                />
                <button
                  type="button"
                  onClick={() => {
                    const target = results[0];
                    if (target) goTo(target.href);
                  }}
                  className="shrink-0 rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] px-5 py-2 text-sm font-semibold text-white transition-transform duration-150 hover:-translate-y-0.5"
                >
                  Search
                </button>
              </div>
            </div>

            {query.trim().length < 2 && (
              <div className="px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-wide text-[#676b7a]/70">
                  Try asking
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTED_QUERIES.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => askQuery(suggestion)}
                      className="rounded-full border border-[#e7e9ee] bg-[#fafbfc] px-4 py-2 text-sm font-medium text-[#1f4693] transition-colors hover:border-[#f7941e]/40 hover:bg-[#fff7ed] hover:text-[#f7941e]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {query.trim().length >= 2 && (
              <div className="max-h-[22rem] overflow-y-auto border-t border-[#f0f1f4] px-2 py-2">
                {loading && (
                  <div className="flex items-center gap-2 px-4 py-4 text-sm text-[#676b7a]">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Searching…
                  </div>
                )}

                {!loading && hasSearched && results.length === 0 && (
                  <div className="px-4 py-4 text-sm text-[#676b7a]">
                    No results for &ldquo;{query.trim()}&rdquo;. Try a different term, or{" "}
                    <button
                      type="button"
                      onClick={() => goTo("/contact")}
                      className="font-semibold text-[#f7941e] hover:underline"
                    >
                      contact us directly
                    </button>
                    .
                  </div>
                )}

                {!loading &&
                  results.map((result, i) => {
                    const Icon = TYPE_ICON[result.type] || FileText;
                    return (
                      <button
                        key={`${result.type}-${result.href}-${i}`}
                        type="button"
                        onClick={() => goTo(result.href)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                          activeIndex === i ? "bg-[#fff7ed]" : "hover:bg-[#fafbfc]"
                        }`}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#1f4693]" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#2b303b]">
                            {result.title}
                          </p>
                          {result.subtitle && (
                            <p className="truncate text-xs text-[#676b7a]">{result.subtitle}</p>
                          )}
                          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-[#f7941e]/80">
                            {result.type}
                          </p>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
          </div>,
          document.body
        )}
    </>
  );
}
