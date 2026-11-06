import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import PageLoader from "@/components/PageLoader";
import { usePathname } from "@/lib/nx/navigation";
import { useAuth } from "@/lib/auth";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import PageFade from "@/components/PageFade";
import FloatingWhatsApp from "@/components/FloatingWhatsApp";
import ScrollToTop from "@/components/ScrollToTop";
import CookieConsent from "@/components/CookieConsent";

export default function SiteChrome() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  // HRMS portals have their own full-screen app shell (no site header/footer).
  const isHrms = /^\/(hr|employee|account-pending)(\/|$)/.test(pathname);
  const isLogin = pathname === "/login";

  if (isAdmin || isHrms) {
    return <Outlet />;
  }

  return (
    <>
      <PageTransition />
      {!isLogin && <Header user={user} />}
      <main className="flex-1">
        <PageFade>
          {/* Header/footer stay mounted while a page chunk loads; only this area shows the
              loader. It fills the viewport so the footer waits below the fold instead of
              being visible and then pushed down when the page arrives (layout shift). */}
          <Suspense fallback={<PageLoader fullHeight />}>
            <Outlet />
          </Suspense>
        </PageFade>
      </main>
      {!isLogin && <Footer />}
      <FloatingWhatsApp />
      <ScrollToTop />
      <CookieConsent />
    </>
  );
}
