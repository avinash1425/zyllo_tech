import { Suspense, lazy } from "react";
import Navbar from "@/components/Navbar";
import BannersSection from "@/components/BannersSection";
import GlobalPresenceSection from "@/components/GlobalPresenceSection";
import ServicesSection from "@/components/ServicesSection";
import Footer from "@/components/Footer";

const IndustriesSection = lazy(() => import("@/components/IndustriesSection"));
const AboutSection = lazy(() => import("@/components/AboutSection"));
const ProcessSection = lazy(() => import("@/components/ProcessSection"));
const WhyZylloSection = lazy(() => import("@/components/WhyZylloSection"));
const TestimonialsSection = lazy(() => import("@/components/TestimonialsSection"));
const TechStackSection = lazy(() => import("@/components/TechStackSection"));
const CareersSection = lazy(() => import("@/components/CareersSection"));
const CTASection = lazy(() => import("@/components/CTASection"));
const ContactBanner = lazy(() => import("@/components/ContactBanner"));
const FloatingButtons = lazy(() => import("@/components/FloatingButtons"));
const CookieConsent = lazy(() => import("@/components/CookieConsent"));

const SectionFallback = () => <div className="h-24 w-full border-t border-border bg-muted/20" aria-hidden="true" />;

const Index = () => {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Navbar />
      <main className="pt-[100px]">
        <BannersSection />
        <div className="border-t border-border">
          <GlobalPresenceSection />
        </div>
        <div className="border-t border-border">
          <ServicesSection />
        </div>
        <Suspense fallback={<SectionFallback />}>
          <div className="border-t border-border">
            <IndustriesSection />
          </div>
          <div className="border-t border-border">
            <AboutSection />
          </div>
          <div className="border-t border-border">
            <ProcessSection />
          </div>
          <div className="border-t border-border">
            <WhyZylloSection />
          </div>
          <div className="border-t border-border">
            <TestimonialsSection />
          </div>
          <div className="border-t border-border">
            <TechStackSection />
          </div>
          <div className="border-t border-border">
            <CareersSection />
          </div>
          <div className="border-t border-border">
            <CTASection />
          </div>
          <ContactBanner />
        </Suspense>
      </main>
      <Footer />
      <Suspense fallback={null}>
        <FloatingButtons />
        <CookieConsent />
      </Suspense>
    </div>
  );
};

export default Index;
