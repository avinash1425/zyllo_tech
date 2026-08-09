import Hero from "@/sections/Hero";
import About from "@/sections/About";
import ServiceTiles from "@/sections/ServiceTiles";
import WhyChooseUs from "@/sections/WhyChooseUs";
import BetterTogether from "@/sections/BetterTogether";
import Process from "@/sections/Process";
import EngagementModels from "@/sections/EngagementModels";
import HomeContactCTA from "@/sections/HomeContactCTA";
import Reveal from "@/components/Reveal";
import { SITE_NAME, DEFAULT_DESCRIPTION } from "@/lib/site-config";

// Homepage previously had no metadata export at all, so it fell back to
// the root layout's defaults verbatim (including the "/" canonical via
// openGraph.url there). This override exists mainly to set an explicit
// canonical <link> and a homepage-specific title that skips the
// " | Zyllo Tech" template suffix (default title already equals SITE_NAME).
export const metadata = {
  title: SITE_NAME,
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <>
      <Hero />
      <Reveal>
        <About />
      </Reveal>
      <Reveal>
        <ServiceTiles />
      </Reveal>
      <Reveal>
        <WhyChooseUs />
      </Reveal>
      <Reveal>
        <BetterTogether />
      </Reveal>
      <Reveal>
        <Process />
      </Reveal>
      <Reveal>
        <EngagementModels />
      </Reveal>
      <Reveal>
        <HomeContactCTA />
      </Reveal>
    </>
  );
}
