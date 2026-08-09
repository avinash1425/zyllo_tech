"use client";

import { ArrowRight, Loader2, Search, Sparkles, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SERVICES } from "@/data/services";

const SUGGESTIONS = [
  "What services does Zyllo Tech offer?",
  "Do you build mobile apps?",
  "How do I get a quote?",
];

// Instant client-side page matching — works whether or not the AI backend
// is configured, so searching "about us", "contact", "portfolio", etc.
// always reliably jumps somewhere instead of depending on an API call.
const SITE_PAGES = [
  { label: "Home", description: "Back to the homepage", href: "/" },
  { label: "About Us", description: "Our story, mission, and leadership", href: "/about" },
  { label: "Services", description: "Everything we build and support", href: "/services" },
  { label: "Industries", description: "Sectors we work with", href: "/industries" },
  { label: "Portfolio", description: "Case studies and past work", href: "/portfolio" },
  { label: "Blog", description: "Articles and updates", href: "/blog" },
  { label: "Careers", description: "Open roles at Zyllo Tech", href: "/careers" },
  { label: "Contact Us", description: "Get in touch with our team", href: "/contact" },
  { label: "Login", description: "Sign in to your account", href: "/login" },
  ...SERVICES.map((service) => ({
    label: service.title,
    description: service.tagline,
    href: `/services/${service.slug}`,
  })),
];

function matchPages(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SITE_PAGES.filter(
    (page) => page.label.toLowerCase().includes(q) || page.description.toLowerCase().includes(q)
  ).slice(0, 6);
}

export default function AISearchBar() {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event) {
      if (event.key === "Escape") closeBar();
    }
    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 60);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      clearTimeout(focusTimer);
    };
  }, [isOpen]);

  function openBar() {
    setIsOpen(true);
  }

  function closeBar() {
    setIsOpen(false);
    setAnswer(null);
    setError(null);
    setQuery("");
  }

  async function ask(text) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setIsLoading(true);
    setAnswer(null);
    setError(null);

    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
      } else {
        setAnswer(data.reply);
      }
    } catch {
      setError("Couldn't reach the search assistant. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    ask(query);
  }

  const pageMatches = useMemo(() => matchPages(query), [query]);

  return (
    <>
      <button
        type="button"
        onClick={openBar}
        aria-label="Ask AI about Zyllo Tech"
        title="AI Search"
        className="group relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#d9dde2] bg-white text-[#6c7889] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#f96706]/50 hover:text-[#f96706] hover:shadow-md hover:shadow-[#f96706]/15"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <Sparkles className="absolute -right-1 -top-1 h-3 w-3 text-[#f96706]" aria-hidden="true" />
      </button>

      {mounted &&
        isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto px-4 pb-6 pt-[12vh] sm:pt-[16vh]"
            role="dialog"
            aria-modal="true"
            aria-label="AI search"
          >
            <div
              aria-hidden="true"
              className="ai-search-backdrop fixed inset-0 bg-[#0b0e17]/55 backdrop-blur-sm"
              onClick={closeBar}
            />

            <div className="ai-search-pop relative w-full max-w-xl overflow-hidden rounded-2xl border border-[#d9dde2] bg-white shadow-2xl">
              <div className="flex items-center gap-2.5 border-b border-[#d9dde2] bg-gradient-to-br from-[#fff2e2] via-white to-[#e6f1f4] px-4 py-3">
                <Image
                  src="/zyllo-icon.png"
                  alt=""
                  width={500}
                  height={273}
                  className="h-6 w-auto shrink-0 drop-shadow-[0_0_6px_rgba(249,103,6,0.35)]"
                />
                <p className="flex-1 text-sm font-semibold text-[#1d2735]">
                  Ask anything about{" "}
                  <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
                    Zyllo Tech
                  </span>
                </p>
                <button
                  type="button"
                  onClick={closeBar}
                  aria-label="Close"
                  className="rounded-md p-1 text-[#6c7889] transition-colors hover:bg-white hover:text-[#1d2735]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-[#6c7889]" aria-hidden="true" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. Do you build mobile apps?"
                  className="flex-1 border-none bg-transparent text-sm text-[#1d2735] placeholder:text-[#6c7889]/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isLoading || !query.trim()}
                  className="inline-flex items-center justify-center rounded-lg bg-[#f96706] px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-[#c9580d] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "Ask"}
                </button>
              </form>

              {!answer && !error && !isLoading && pageMatches.length > 0 && (
                <div className="border-t border-[#d9dde2] px-4 py-3">
                  <p className="text-xs font-semibold tracking-wide text-[#6c7889] uppercase">
                    Pages
                  </p>
                  <div className="mt-2 flex flex-col gap-1">
                    {pageMatches.map((page) => (
                      <Link
                        key={page.href}
                        href={page.href}
                        onClick={closeBar}
                        className="group flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-200 hover:bg-[#eef0f2]"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[#1d2735]">
                            {page.label}
                          </span>
                          <span className="block truncate text-xs text-[#6c7889]">
                            {page.description}
                          </span>
                        </span>
                        <ArrowRight
                          className="h-3.5 w-3.5 shrink-0 text-[#6c7889] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#f96706]"
                          aria-hidden="true"
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {!answer && !error && !isLoading && query.trim().length === 0 && (
                <div className="border-t border-[#d9dde2] px-4 py-3">
                  <p className="text-xs font-semibold tracking-wide text-[#6c7889] uppercase">
                    Try asking
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          setQuery(suggestion);
                          ask(suggestion);
                        }}
                        className="rounded-lg px-2.5 py-1.5 text-left text-sm text-[#1d2735] transition-colors duration-200 hover:bg-[#eef0f2]"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center gap-2 border-t border-[#d9dde2] px-4 py-4 text-sm text-[#6c7889]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#f96706]" aria-hidden="true" />
                  Thinking...
                </div>
              )}

              {error && (
                <div className="border-t border-[#d9dde2] px-4 py-4 text-sm text-[#6c7889]">{error}</div>
              )}

              {answer && (
                <div className="max-h-64 overflow-y-auto border-t border-[#d9dde2] px-4 py-4 text-sm leading-relaxed text-[#1d2735]">
                  {answer}
                </div>
              )}
            </div>

            <style jsx>{`
              @keyframes aiSearchBackdropFadeIn {
                from {
                  opacity: 0;
                }
                to {
                  opacity: 1;
                }
              }
              .ai-search-backdrop {
                animation: aiSearchBackdropFadeIn 0.2s ease-out both;
              }
              @keyframes aiSearchPop {
                from {
                  opacity: 0;
                  transform: scale(0.97) translateY(-8px);
                }
                to {
                  opacity: 1;
                  transform: scale(1) translateY(0);
                }
              }
              .ai-search-pop {
                animation: aiSearchPop 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
              }
            `}</style>
          </div>,
          document.body
        )}
    </>
  );
}
