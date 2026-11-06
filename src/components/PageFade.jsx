"use client";

import { AnimatePresence, LazyMotion, m } from "framer-motion";
import { usePathname } from "@/lib/nx/navigation";
import { whenIdle } from "@/lib/when-idle";

// The animation engine loads separately: this wrapper is on every page, the
// first render does not animate (initial={false}), and it is normally ready
// before the first navigation. Until then a route change simply cuts over.
const loadFeatures = () =>
  whenIdle().then(() => import("framer-motion")).then((mod) => mod.domAnimation);

// Wraps page content so every route change animates in with a subtle
// fade + slide instead of Next.js's default hard cut. Keyed on pathname
// so AnimatePresence treats each route as a distinct element and runs
// exit/enter animations around the swap.
export default function PageFade({ children }) {
  const pathname = usePathname();

  return (
    <LazyMotion features={loadFeatures}>
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={pathname}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </m.div>
      </AnimatePresence>
    </LazyMotion>
  );
}
