import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import CookieConsent from "@/components/CookieConsent";
import SEOHead from "@/components/SEOHead";
import Hero from "@/sections/Hero";
import About from "@/sections/About";
import ServiceTiles from "@/sections/ServiceTiles";
import WhyChooseUs from "@/sections/WhyChooseUs";
import BetterTogether from "@/sections/BetterTogether";
import Process from "@/sections/Process";
import EngagementModels from "@/sections/EngagementModels";
import HomeContactCTA from "@/sections/HomeContactCTA";
import Reveal from "@/components/Reveal";

export default function Index() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <SEOHead
        title="Zyllo Tech | Software Development, AI & Cloud Engineering"
        description="Zyllo Tech builds scalable web, mobile, AI and cloud solutions for growing businesses and enterprises."
        canonical="/"
        keywords="software development company India, mobile app development, AI solutions, cloud engineering"
      />
      <Navbar />
      <main className="pt-[100px]">
        <Hero />
        <Reveal><About /></Reveal>
        <Reveal><ServiceTiles /></Reveal>
        <Reveal><WhyChooseUs /></Reveal>
        <Reveal><BetterTogether /></Reveal>
        <Reveal><Process /></Reveal>
        <Reveal><EngagementModels /></Reveal>
        <Reveal><HomeContactCTA /></Reveal>
      </main>
      <Footer />
      <FloatingButtons />
      <CookieConsent />
    </div>
  );
}
