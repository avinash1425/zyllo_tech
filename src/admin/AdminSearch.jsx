
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/lib/nx/navigation";
import { searchAdmin } from "@/lib/api/admin/search";
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
  const inputRef = useRef(null);
  const router = useRouter();

  // Ctrl/Cmd + K focuses the search box.
  useEffect(() => {
    function onShortcut(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

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
        setResults(await searchAdmin(trimmed));
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
      const fresh = await searchAdmin(trimmed);
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
    <div ref={containerRef} className="relative w-full sm:max-w-md sm:flex-1">
      <Search
        className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#6b7280]"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search contacts, applicants, posts…"
        aria-label="Search the admin"
        className="h-11 w-full rounded-xl border border-[#e3e6ee] bg-[#f4f6fa] pl-11 pr-16 text-sm text-[#101a3a] outline-none transition-all placeholder:text-[#6b7280] hover:border-[#cfd5e2] focus:border-[#f7941e] focus:bg-white focus:ring-4 focus:ring-[#f7941e]/20"
      />
      {!query && (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-[#dfe3ec] bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#6b7280] shadow-[0_1px_0_#dfe3ec] lg:inline-flex">
          Ctrl K
        </kbd>
      )}

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-xl border border-[#e7e9ee] bg-white shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-[#676b7a]">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
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
