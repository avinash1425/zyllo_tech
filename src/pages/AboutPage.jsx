import { Briefcase, Layers, Mail, Users } from "lucide-react";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import OurStory from "@/sections/OurStory";
import Leadership from "@/sections/Leadership";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Values from "@/sections/Values";
import Technologies from "@/sections/Technologies";
import Reveal from "@/components/Reveal";

export default function AboutPage() {
  return (
    <>
      <SEOHead
        title="About Us | Zyllo Tech"
        description="Zyllo Tech is an India-based software company partnering with businesses to design, build, and support intelligent digital products."
        canonical="/about"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "About", url: `${SITE_URL}/about` },
        ])}
      />
      <PageHero
        breadcrumbLabel="About"
        eyebrow="About Zyllo Tech"
        title="Building Digital Solutions That Drive Growth"
        description="We are a technology company dedicated to delivering innovative, scalable, and reliable software solutions for businesses worldwide."
        image="/about.webp"
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
        <Leadership />
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
    </>
  );
}
