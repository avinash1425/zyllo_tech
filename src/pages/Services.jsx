import Seo from "@/components/Seo";
import PageHero from "@/components/PageHero";
import WhatWeBelieve from "@/sections/WhatWeBelieve";
import ServiceGrid from "@/sections/ServiceGrid";
import Reveal from "@/components/Reveal";

export default function ServicesPage() {
  return (
    <>
      <Seo 
        title="Services"
        description="Web, mobile, AI, cloud, and security engineering services from Zyllo Tech — end-to-end software delivery under one team."
        path="/services"
       />
      <PageHero
        breadcrumbLabel="Services"
        eyebrow="Our Services"
        title="Technology Solutions for Modern Businesses"
        description="From strategy to deployment, we deliver complete software solutions that help businesses grow, innovate, and succeed."
        image="/woman-enjoying-vr-headset.jpg"
        imageAlt="Woman using a VR headset, representing immersive and emerging technology"
        size="lg"
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
