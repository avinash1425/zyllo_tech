"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

// Structure referenced from gcoman.com's own "Back to top" button — fixed
// bottom-right, fades/slides in past a scroll threshold, stacked directly
// above the WhatsApp button rather than overlapping it.
export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 400);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      className={`fixed bottom-20 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#f96706] text-white shadow-xl shadow-black/20 transition-all duration-300 hover:scale-110 hover:bg-[#c9580d] hover:shadow-2xl sm:bottom-24 sm:right-6 sm:h-14 sm:w-14 ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <ArrowUp className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
    </button>
  );
}
