import { Briefcase, Layers, Mail, Users } from "lucide-react";
import PageHero from "@/components/PageHero";
import OurStory from "@/sections/OurStory";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Values from "@/sections/Values";
import Technologies from "@/sections/Technologies";
import Reveal from "@/components/Reveal";

export const metadata = {
  title: "About Us | Zyllo Tech",
  description:
    "Zyllo Tech is an India-based software company partnering with businesses to design, build, and support intelligent digital products.",
};

export default function AboutPage() {
  return (
    <>
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
