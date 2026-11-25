// Top-bar role switcher (migration 269): a person with several roles (e.g. HR + Manager + Employee) picks
// which role they are working as. Switching only changes the menus and pages shown — it never signs out
// and never punches out. Buttons only (no dropdown <select>, per the site's no-dropdowns rule).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Repeat2 } from "lucide-react";
import { roleHome, useAccess } from "@/lib/access";

const AREA_LABEL = { admin: "Admin dashboard", portal: "Employee Portal" };

function whereItOpens(role) {
  return roleHome(role) === "/employee" ? AREA_LABEL.portal : AREA_LABEL.admin;
}

export default function RoleSwitcher({ className = "" }) {
  const { roles, activeRole, setActiveRole } = useAccess();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Only people with more than one role get the switcher.
  if (!activeRole || roles.length < 2) return null;

  function choose(role) {
    setOpen(false);
    if (role.key === activeRole.key) return;
    setActiveRole(role.key);
    // Open the role's own part of the site: HR / Admin / Super Admin -> admin dashboard,
    // Manager / Team Lead / Employee -> Employee Portal (or the other part when the role has nothing there).
    navigate(roleHome(role));
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch role"
        className="flex h-11 items-center gap-2 rounded-xl border border-[#1f4693]/25 bg-[#eef2fb] px-3 text-sm font-semibold text-[#1f4693] shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-all hover:border-[#1f4693]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693]"
      >
        <Repeat2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[10.5px] font-medium uppercase tracking-wide text-[#1f4693]/70">Role</span>
          <span className="block max-w-[120px] truncate">{activeRole.name}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div role="menu" aria-label="Switch role" className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-[#e7e9ee] bg-white shadow-lg">
          <div className="border-b border-[#e7e9ee] px-4 py-3">
            <p className="text-sm font-semibold text-[#2b303b]">Switch role</p>
            <p className="text-xs text-[#676b7a]">You stay signed in, and your punch-in is not affected.</p>
          </div>
          <div className="p-1.5">
            {roles.map((role) => {
              const current = role.key === activeRole.key;
              return (
                <button
                  key={role.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  onClick={() => choose(role)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    current ? "bg-[#eef2fb]" : "hover:bg-[#fafbfc]"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold ${current ? "text-[#1f4693]" : "text-[#2b303b]"}`}>{role.name}</span>
                    <span className="block text-xs text-[#676b7a]">{whereItOpens(role)}</span>
                  </span>
                  {current && <Check className="h-4 w-4 shrink-0 text-[#1f4693]" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
