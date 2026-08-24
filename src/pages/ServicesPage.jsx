import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import WhatWeBelieve from "@/sections/WhatWeBelieve";
import ServiceGrid from "@/sections/ServiceGrid";
import Reveal from "@/components/Reveal";

export default function ServicesPage() {
  return (
    <>
      <SEOHead
        title="Services | Zyllo Tech"
        description="Web, mobile, AI, cloud, and security engineering services from Zyllo Tech — end-to-end software delivery under one team."
        canonical="/services"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Services", url: `${SITE_URL}/services` },
        ])}
      />
      <PageHero
        breadcrumbLabel="Services"
        eyebrow="Our Services"
        title="Technology Solutions for Modern Businesses"
        description="From strategy to deployment, we deliver complete software solutions that help businesses grow, innovate, and succeed."
        image="https://images.unsplash.com/photo-1547658719-da2b51169166?w=1920&q=70&auto=format"
        imageAlt="Developer working on web application code"
      />
      <Reveal>
        <WhatWeBelieve />
      </Reveal>
      <Reveal>
        <ServiceGrid />
      </Reveal>
    </>
  );
}
