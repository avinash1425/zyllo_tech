import Seo from "@/components/Seo";
import { Briefcase, Layers, Mail, Users } from "lucide-react";
import PageHero from "@/components/PageHero";
import OurStory from "@/sections/OurStory";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Values from "@/sections/Values";
import Technologies from "@/sections/Technologies";
import Reveal from "@/components/Reveal";
import IndiaDelivery from "@/sections/IndiaDelivery";
import ServiceFaq from "@/sections/ServiceFaq";
import { INDIA_FAQS } from "@/data/india-service-areas";

// FAQPage structured data for the India FAQ shown on this page.
const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: INDIA_FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

export default function AboutPage() {
  return (
    <>
      <Seo 
        title="About Us: Software Development Company in India"
        description="Zyllo Tech is a software development company in Guntur, India, partnering remotely with businesses worldwide to design, build and support digital products."
        path="/about"
      >
        <script type="application/ld+json">{JSON.stringify(FAQ_JSON_LD)}</script>
      </Seo>
      <PageHero
        breadcrumbLabel="About"
        eyebrow="About Zyllo Tech"
        title="Building Digital Solutions That Drive Growth"
        description="We are a technology company dedicated to delivering innovative, scalable, and reliable software solutions for businesses worldwide."
        image="/about.png"
        imageAlt="The Zyllo Tech team at work"
        quickLinks={[
          { icon: Layers, label: "Services", href: "/services" },
          { icon: Briefcase, label: "Portfolio", href: "/portfolio" },
          { icon: Users, label: "Careers", href: "/careers" },
          { icon: Mail, label: "Contact", href: "/contact" },
        ]}
      />
      <Reveal>
        <OurStory />
      </Reveal>
      <Reveal>
        <WhyChooseUs />
      </Reveal>
      <Reveal>
        <Values />
      </Reveal>
      <Reveal>
        <Technologies />
      </Reveal>
      <Reveal>
        <IndiaDelivery />
      </Reveal>
      <ServiceFaq serviceName="Working with us from elsewhere in India" faqs={INDIA_FAQS} />
    </>
  );
}
