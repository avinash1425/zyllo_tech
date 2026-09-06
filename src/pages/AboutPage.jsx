import { Briefcase, Layers, Mail, Users } from "lucide-react";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import OurStory from "@/sections/OurStory";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Values from "@/sections/Values";
import Technologies from "@/sections/Technologies";
import Reveal from "@/components/Reveal";

export default function AboutPage() {
  return (
    <>
      <SEOHead
        title="About Us | Zyllo Tech"
        description="Zyllo Tech is a Hyderabad-based software engineering company. Meet the team behind our web, mobile, AI/ML, and cloud solutions."
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
        description="Zyllo Tech builds custom web, mobile, AI, and cloud software for startups and SMBs in India, the US, and Europe. Founded in 2023, we're a deliberately small senior team with a simple process — discovery, written scope, weekly demos, launch, support — and we'd rather show you how we work than rent logos."
        image="/about.webp"
        imageAlt="Software team collaborating at work"
        primaryCta={{ label: "Start Your Project", href: "/contact" }}
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
    </>
  );
}
