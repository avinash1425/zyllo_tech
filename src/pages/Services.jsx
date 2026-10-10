import Seo from "@/components/Seo";
import PageHero from "@/components/PageHero";
import WhatWeBelieve from "@/sections/WhatWeBelieve";
import ServiceGrid from "@/sections/ServiceGrid";
import Reveal from "@/components/Reveal";
import GlobalDelivery from "@/sections/GlobalDelivery";
import ServiceFaq from "@/sections/ServiceFaq";
import { INTERNATIONAL_FAQS } from "@/data/service-areas";

// FAQPage structured data for the international FAQ shown on this page.
const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: INTERNATIONAL_FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

export default function ServicesPage() {
  return (
    <>
      <Seo 
        title="Software Development Services: Web, Mobile & AI"
        description="Custom software, web, mobile app, AI, cloud, QA and cybersecurity services from Zyllo Tech, one team in India delivering remotely to businesses worldwide."
        path="/services"
      >
        <script type="application/ld+json">{JSON.stringify(FAQ_JSON_LD)}</script>
      </Seo>
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
      <Reveal>
        <GlobalDelivery
          heading="Software Development Services, Delivered Remotely Worldwide"
          excludeHref="/services"
          showCountries
        />
      </Reveal>
      <ServiceFaq serviceName="Working with us from another country" faqs={INTERNATIONAL_FAQS} />
    </>
  );
}
