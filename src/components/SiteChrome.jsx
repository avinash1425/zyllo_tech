import { lazy, Suspense } from "react";
import { usePathname } from "@/components/NextCompat";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import PageFade from "@/components/PageFade";
import CookieConsent from "@/components/CookieConsent";

// Below-the-fold, non-critical — keep it out of the eagerly-loaded bundle
// every page pays for on first load.
const FloatingWhatsApp = lazy(() => import("@/components/FloatingWhatsApp"));

export default function SiteChrome({ children, user = undefined }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLogin = pathname === "/login";

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <PageTransition />
      {!isLogin && <Header user={user} />}
      <main className="flex-1">
        <PageFade>{children}</PageFade>
      </main>
      {!isLogin && <Footer />}
      <Suspense fallback={null}>
        <FloatingWhatsApp />
      </Suspense>
      <CookieConsent />
    </>
  );
}
