import Hero from "@/sections/Hero";
import Services from "@/sections/Services";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Process from "@/sections/Process";
import About from "@/sections/About";
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
        <Services />
      </Reveal>
      <Reveal>
        <WhyChooseUs />
      </Reveal>
      <Reveal>
        <Process />
      </Reveal>
      <Reveal>
        <About />
      </Reveal>
      <Reveal>
        <HomeContactCTA />
      </Reveal>
    </>
  );
}


