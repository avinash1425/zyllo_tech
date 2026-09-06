import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Shared lightweight modal shell: dims the page, traps the content in a
// centered scrollable panel, and closes on Escape or backdrop click.
//
// Rendered via a portal straight to document.body. Sections on this site
// are wrapped in <Reveal>, which sets `will-change: transform` on its
// wrapper — that creates a new containing block for any `position: fixed`
// descendant (same effect as an actual transform), so a modal rendered
// in-place would end up pinned to that section's box instead of the real
// viewport. Portaling out of the Reveal tree avoids that entirely.
export default function Modal({
  isOpen,
  onClose,
  children,
  maxWidthClassName = "max-w-2xl",
  label,
  labelledBy,
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    dialogRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 sm:p-6 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
    >
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[#0b0e17]/60 backdrop-blur-sm modal-fade-in"
        onClick={onClose}
      />

      <div
        className={`relative w-full ${maxWidthClassName} modal-pop-in my-auto overflow-hidden rounded-2xl bg-white shadow-2xl`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[#676b7a] shadow-md transition-colors duration-200 hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
        >
          <X className="h-4.5 w-4.5" aria-hidden="true" />
        </button>

        <div className="max-h-[85vh] overflow-y-auto">{children}</div>
      </div>

      <style>{`
        .modal-fade-in {
          animation: modalFadeIn 0.2s ease-out both;
        }
        .modal-pop-in {
          animation: modalPopIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes modalFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes modalPopIn {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(12px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
