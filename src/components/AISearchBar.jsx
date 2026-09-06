import { ArrowRight, FileText, Layers, Newspaper, Search, Sparkles, X } from "lucide-react";
import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { useRouter } from "@/components/NextCompat";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Chips that run real searches against the local index — every one of these
// returns results.
const SUGGESTIONS = [
  "Mobile app development",
  "AI solutions",
  "Cloud services",
  "Careers",
];

// Results are grouped by content type, in this display order.
const GROUPS = [
  { type: "service", label: "Services", icon: Layers },
  { type: "article", label: "From the blog", icon: Newspaper },
  { type: "page", label: "Pages", icon: FileText },
];

// The search index (src/lib/site-search-index.js) pulls in the full blog
// archive, so it's loaded via dynamic import on first open — this component
// ships eagerly with the sitewide Header and must stay out of the main
// bundle's critical path. The promise is cached at module scope.
let searchModulePromise = null;
function loadSearchModule() {
  if (!searchModulePromise) {
    searchModulePromise = import("@/lib/site-search-index");
  }
  return searchModulePromise;
}

// Header search: a smart sitewide search over pages, services, and blog
// articles. Purely client-side keyword matching — it finds and links to real
// content, it does not generate answers.
export default function AISearchBar() {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef(null);
  const router = useRouter();

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
    // Warm the index chunk while the user is still typing.
    loadSearchModule();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    // Local search is instant; the tiny debounce just avoids re-ranking on
    // every keystroke of a fast typist.
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const { search } = await loadSearchModule();
      if (cancelled) return;
      setResults(search(trimmed, { limit: 9 }));
      setHasSearched(true);
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  function openBar() {
    setIsOpen(true);
  }

  function closeBar() {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setHasSearched(false);
  }

  function goTo(href) {
    closeBar();
    router.push(href);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (results.length > 0) goTo(results[0].url);
  }

  const trimmedQuery = query.trim();
  const hasArticleResults = results.some((result) => result.type === "article");

  return (
    <>
      <button
        type="button"
        onClick={openBar}
        aria-label="Search Zyllo Tech"
        title="Search"
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
            aria-label="Site search"
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
                  width={1130}
                  height={660}
                  className="h-6 w-auto shrink-0 drop-shadow-[0_0_6px_rgba(249,103,6,0.35)]"
                />
                <p className="flex-1 text-sm font-semibold text-[#1d2735]">
                  Search Zyllo Tech
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
                  placeholder="Search services, articles, pages…"
                  className="flex-1 border-none bg-transparent text-sm text-[#1d2735] placeholder:text-[#6c7889]/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={results.length === 0}
                  className="inline-flex items-center justify-center rounded-lg bg-[#f96706] px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-[#c9580d] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Search
                </button>
              </form>

              {trimmedQuery.length < 2 && (
                <div className="border-t border-[#d9dde2] px-4 py-3">
                  <p className="text-xs font-semibold tracking-wide text-[#6c7889] uppercase">
                    Try searching
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setQuery(suggestion)}
                        className="rounded-lg px-2.5 py-1.5 text-left text-sm text-[#1d2735] transition-colors duration-200 hover:bg-[#eef0f2]"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {hasSearched && results.length === 0 && (
                <div className="border-t border-[#d9dde2] px-4 py-4 text-sm text-[#6c7889]">
                  No results for &ldquo;{trimmedQuery}&rdquo;. Try a different term, or{" "}
                  <Link
                    href="/contact"
                    onClick={closeBar}
                    className="font-semibold text-[#f96706] hover:underline"
                  >
                    contact us directly
                  </Link>
                  .
                </div>
              )}

              {results.length > 0 && (
                <div className="max-h-72 overflow-y-auto border-t border-[#d9dde2]">
                  {GROUPS.map(({ type, label, icon: Icon }) => {
                    const groupResults = results.filter((result) => result.type === type);
                    if (groupResults.length === 0) return null;
                    return (
                      <div key={type} className="px-4 py-3">
                        <p className="text-xs font-semibold tracking-wide text-[#6c7889] uppercase">
                          {label}
                        </p>
                        <div className="mt-2 flex flex-col gap-1">
                          {groupResults.map((result) => (
                            <Link
                              key={result.url}
                              href={result.url}
                              onClick={closeBar}
                              className="group flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-200 hover:bg-[#eef0f2]"
                            >
                              <span className="flex min-w-0 items-start gap-2.5">
                                <Icon
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6c7889]"
                                  aria-hidden="true"
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-[#1d2735]">
                                    {result.title}
                                  </span>
                                  <span className="block truncate text-xs text-[#6c7889]">
                                    {result.description}
                                  </span>
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
                    );
                  })}

                  {hasArticleResults && (
                    <Link
                      href={`/blog?q=${encodeURIComponent(trimmedQuery)}`}
                      onClick={closeBar}
                      className="flex items-center gap-1.5 border-t border-[#d9dde2] bg-[#fafbfc] px-4 py-3 text-sm font-semibold text-[#c2410c] transition-colors duration-200 hover:bg-[#eef0f2]"
                    >
                      See all blog results for &ldquo;{trimmedQuery}&rdquo;
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              )}
            </div>

            <style>{`
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
