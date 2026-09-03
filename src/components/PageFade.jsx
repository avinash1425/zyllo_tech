import { usePathname } from "@/components/NextCompat";

// Wraps page content so every route change animates in with a subtle
// fade + slide instead of a hard cut. Pure CSS (keyed div + Tailwind
// keyframe) instead of framer-motion — this wraps every route via
// SiteChrome, which is imported eagerly in App.tsx, so framer-motion
// was shipping in the main bundle for every page just for this.
export default function PageFade({ children }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="animate-page-fade">
      {children}
    </div>
  );
}
