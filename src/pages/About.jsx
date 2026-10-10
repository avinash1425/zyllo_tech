import Seo from "@/components/Seo";
import { Briefcase, Layers, Mail, Users } from "lucide-react";
import PageHero from "@/components/PageHero";
import OurStory from "@/sections/OurStory";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Values from "@/sections/Values";
import Technologies from "@/sections/Technologies";
import Reveal from "@/components/Reveal";

export default function AboutPage() {
  return (
    <>
      <Seo 
        title="About Us: Software Development Company in India"
        description="Zyllo Tech is a software development company in Guntur, India, partnering remotely with businesses worldwide to design, build and support digital products."
        path="/about"
       />
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
    </>
  );
}
