import { usePathname } from "@/components/NextCompat";
import { useEffect, useRef, useState } from "react";

// Slim top progress bar shown during client-side navigation. Replaces the
// old full-screen loader overlay: on a qualifying internal-link click the
// bar runs 0 → 70% quickly, then completes to 100% and fades out once the
// new route's pathname lands.
export default function PageTransition() {
  const pathname = usePathname();
  const [isActive, setIsActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isFading, setIsFading] = useState(false);
  const isFirstRender = useRef(true);
  const startFrameRef = useRef(null);
  const finishTimeoutRef = useRef(null);

  // Start the bar as soon as a navigation click happens.
  useEffect(() => {
    function handleClick(e) {
      // Modified clicks (new tab/window, download) never navigate this
      // document — showing the bar would leave it stuck.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      const link = e.target.closest("a");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      if (link.target === "_blank") return;

      // Strip any hash/query before comparing so same-page anchor links
      // (e.g. "/services#services-grid" while already on "/services")
      // don't trigger the bar — pathname alone would never change,
      // leaving it stuck visible.
      const hrefPath = href.split("#")[0].split("?")[0] || "/";
      if (hrefPath === pathname) return;

      if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
      if (startFrameRef.current) cancelAnimationFrame(startFrameRef.current);
      setIsFading(false);
      setIsActive(true);
      setProgress(0);
      // Let the bar paint at width 0 first so the 0 → 70% run animates.
      startFrameRef.current = requestAnimationFrame(() => {
        startFrameRef.current = requestAnimationFrame(() => setProgress(70));
      });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  // The new route has rendered (pathname changed): run to 100% and fade out.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (startFrameRef.current) cancelAnimationFrame(startFrameRef.current);
    if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);

    setProgress(100);
    setIsFading(true);
    finishTimeoutRef.current = setTimeout(() => {
      setIsActive(false);
      setIsFading(false);
      setProgress(0);
    }, 500);

    return () => {
      if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
    };
  }, [pathname]);

  // Safety net: if the bar is visible but no route change ever lands
  // (blocked navigation, preventDefault'ed click, etc.), force-hide it.
  useEffect(() => {
    if (!isActive) return;
    const safetyTimeout = setTimeout(() => {
      setIsActive(false);
      setIsFading(false);
      setProgress(0);
    }, 8000);
    return () => clearTimeout(safetyTimeout);
  }, [isActive, pathname]);

  if (!isActive) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div
        className="nav-progress-bar h-full rounded-r-full"
        style={{ width: `${progress}%`, opacity: isFading ? 0 : 1 }}
      />
      <style>{`
        .nav-progress-bar {
          background: linear-gradient(90deg, #f96706, #3089a6);
          box-shadow: 0 0 8px rgba(249, 103, 6, 0.45);
          transition: width 0.4s ease-out, opacity 0.35s ease-out 0.1s;
        }
        @media (prefers-reduced-motion: reduce) {
          .nav-progress-bar {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
