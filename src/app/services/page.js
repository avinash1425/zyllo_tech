import PageHero from "@/components/PageHero";
import WhatWeBelieve from "@/sections/WhatWeBelieve";
import ServiceGrid from "@/sections/ServiceGrid";
import BetterTogether from "@/sections/BetterTogether";
import Reveal from "@/components/Reveal";

export const metadata = {
  title: "Services | Zyllo Tech",
  description:
    "Web, mobile, AI, cloud, and security engineering services from Zyllo Tech — end-to-end software delivery under one team.",
};

export default function ServicesPage() {
  return (
    <>
      <PageHero
        eyebrow="Our Services"
        title="Software services built around your product, not our org chart"
        description="Strategy, design, engineering, and support — delivered by one accountable team instead of a chain of vendors."
        image="https://images.unsplash.com/photo-1547658719-da2b51169166?w=1920&q=80"
        imageAlt="Developer working on web application code"
      />
      <Reveal>
        <WhatWeBelieve />
      </Reveal>
      <Reveal>
        <ServiceGrid />
      </Reveal>
      <Reveal>
        <BetterTogether />
      </Reveal>
    </>
  );
}
