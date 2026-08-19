import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "@/components/NextCompat";

// Wraps page content so every route change animates in with a subtle
// fade + slide instead of Next.js's default hard cut. Keyed on pathname
// so AnimatePresence treats each route as a distinct element and runs
// exit/enter animations around the swap.
export default function PageFade({ children }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
