import PageHero from "@/components/PageHero";
import OurStory from "@/sections/OurStory";
import MissionVision from "@/sections/MissionVision";
import Values from "@/sections/Values";
import Technologies from "@/sections/Technologies";
import ContactCTA from "@/sections/ContactCTA";
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
        eyebrow="About Zyllo Tech"
        title="The team behind your next product"
        description="We're a small, senior team of engineers and designers based in India, working with founders and businesses around the world."
        image="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1920&q=80"
        imageAlt="Zyllo Tech team collaborating"
      />
      <Reveal>
        <OurStory />
      </Reveal>
      <Reveal>
        <MissionVision />
      </Reveal>
      <Reveal>
        <Values />
      </Reveal>
      <Reveal>
        <Technologies />
      </Reveal>
      <Reveal>
        <ContactCTA
          heading="Like the way we think? Let's build something."
          description="Tell us about your project and we'll get back to you within one business day."
        />
      </Reveal>
    </>
  );
}
