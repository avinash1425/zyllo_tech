import Seo from "@/components/Seo";
import { HOME_TITLE } from "@/lib/site-config";
import GlobalDelivery from "@/sections/GlobalDelivery";
import Hero from "@/sections/Hero";
import About from "@/sections/About";
import ServiceTiles from "@/sections/ServiceTiles";
import WhyChooseUs from "@/sections/WhyChooseUs";
import BetterTogether from "@/sections/BetterTogether";
import Process from "@/sections/Process";
import EngagementModels from "@/sections/EngagementModels";
import HomeContactCTA from "@/sections/HomeContactCTA";
import Reveal from "@/components/Reveal";


export default function HomePage() {
  return (
    <>
      <Seo absoluteTitle={HOME_TITLE} path="/" />
      <Hero />
      <Reveal>
        <About />
      </Reveal>
      <Reveal>
        <ServiceTiles />
      </Reveal>
      <Reveal>
        <GlobalDelivery />
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
