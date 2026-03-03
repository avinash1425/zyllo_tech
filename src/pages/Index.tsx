import Navbar from "@/components/Navbar";

import BannersSection from "@/components/BannersSection";
import ServicesSection from "@/components/ServicesSection";
import IndustriesSection from "@/components/IndustriesSection";
import AboutSection from "@/components/AboutSection";
import ProcessSection from "@/components/ProcessSection";
import WhyZylloSection from "@/components/WhyZylloSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import TechStackSection from "@/components/TechStackSection";
import CareersSection from "@/components/CareersSection";
import ContactBanner from "@/components/ContactBanner";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import CookieConsent from "@/components/CookieConsent";

const Index = () => {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Navbar />
      <main className="pt-[100px]">
        <BannersSection />
        <div className="border-t border-border">
          <ServicesSection />
        </div>
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
      </main>
      <Footer />
      <FloatingButtons />
      <CookieConsent />
    </div>
  );
};

export default Index;
