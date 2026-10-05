"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared modal shell. Backdrop blur, animated enter/exit (instant under
// prefers-reduced-motion), bottom-sheet on phones / centred dialog on
// desktop, focus trap, Escape to close, focus return and body scroll lock.
//
// Backward compatible: `isOpen`, `onClose`, `children`, `maxWidthClassName`
// behave as before. Optional extras:
//   labelledBy  - id of the element that titles the dialog (aria-labelledby)
//   ariaLabel   - fallback accessible name when there is no visible title
//   showClose   - render the built-in floating close button (default true)
//   scroll      - wrap children in a scrolling region (default true). Pass
//                 false when children manage their own header/footer.
//
// Rendered through a portal to document.body: <Reveal> wrappers set
// `will-change: transform`, which would otherwise pin `position: fixed`
// descendants to the section instead of the viewport.
export default function Modal({
  isOpen,
  onClose,
  children,
  maxWidthClassName = "max-w-2xl",
  labelledBy,
  ariaLabel,
  showClose = true,
  scroll = true,
}) {
  const [mounted, setMounted] = useState(false);
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const raf = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  if (!mounted) return null;

  const t = reduce ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 32, mass: 0.9 };
  const tExit = reduce ? { duration: 0 } : { duration: 0.2, ease: [0.4, 0, 1, 1] };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-root"
          className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-[#0b1226]/60 to-[#101a3a]/75 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2 }}
            onClick={() => onCloseRef.current?.()}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : ariaLabel || "Dialog"}
            tabIndex={-1}
            initial={reduce ? false : { opacity: 0, y: 72, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: t }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.98, transition: tExit }}
            className={`relative flex max-h-[92dvh] w-full ${maxWidthClassName} flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-[0_-8px_40px_-8px_rgba(16,26,58,0.4)] ring-1 ring-black/5 outline-none sm:max-h-[88vh] sm:rounded-[2rem] sm:shadow-[0_40px_80px_-20px_rgba(16,26,58,0.55)]`}
          >
            {showClose && (
              <button
                type="button"
                onClick={() => onCloseRef.current?.()}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[#676b7a] shadow-md transition-colors duration-200 hover:bg-[#f7941e]/10 hover:text-[#b3560a] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <div
              className={
                scroll
                  ? "min-h-0 flex-1 overflow-y-auto overscroll-contain"
                  : "flex min-h-0 flex-1 flex-col"
              }
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
