"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Floating circular button, bottom-right, that only appears once the
 * admin has scrolled past a threshold — the dashboard is a single long
 * page (traffic, activity, applicants-by-job all stack vertically), so
 * this is a real convenience once there's enough content to scroll.
 */
export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 400);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#f7941e] text-white shadow-lg shadow-[#f7941e]/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17] hover:shadow-xl"
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
