"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import PageFade from "@/components/PageFade";
import FloatingWhatsApp from "@/components/FloatingWhatsApp";
import CookieConsent from "@/components/CookieConsent";

export default function SiteChrome({ children, user }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <PageTransition />
      <Header user={user} />
      <main className="flex-1">
        <PageFade>{children}</PageFade>
      </main>
      <Footer />
      <FloatingWhatsApp />
      <CookieConsent />
    </>
  );
}
