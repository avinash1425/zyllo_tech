import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { searchCountries } from "@/lib/countries";

/**
 * Searchable country dropdown (combobox). Click to open, type to filter,
 * arrow keys + Enter or click to pick, Escape to close.
 */
export default function CountrySelect({ id, value, onChange, invalid }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const options = useMemo(() => searchCountries(query), [query]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
    setQuery("");
    const idx = Math.max(0, searchCountries("").indexOf(value));
    setActive(idx);
    setOpen(true);
  }

  function pick(name) {
    onChange(name);
    setOpen(false);
  }

  function onSearchKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options[active]) pick(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-lg border bg-white px-3.5 py-2.5 text-left text-sm outline-none focus:border-[#1f4693]/60 ${
          invalid ? "border-red-400" : "border-[#e7e9ee]"
        }`}
      >
        <span className={value ? "text-[#2b303b]" : "text-[#9aa0ad]"}>{value || "Select a country"}</span>
        <ChevronDown className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-[#e7e9ee] bg-white shadow-lg">
          <div className="relative border-b border-[#eef0f3] p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-controls={listId}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              aria-label="Search countries"
              placeholder="Type to search…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
              className="w-full rounded-md border border-[#e7e9ee] py-2 pl-8 pr-3 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/60"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Countries" className="max-h-56 overflow-y-auto py-1">
            {options.length === 0 ? (
              <li className="px-3.5 py-2 text-sm text-[#676b7a]">No country matches “{query}”.</li>
            ) : (
              options.map((name, i) => (
                <li
                  key={name}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={name === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(name)}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-3.5 py-2 text-sm ${
                    i === active ? "bg-[#f7941e]/10 text-[#2b303b]" : "text-[#2b303b]"
                  } ${name === value ? "font-semibold" : ""}`}
                >
                  {name}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
