import PageHero from "@/components/PageHero";
import OurStory from "@/sections/OurStory";
import WhyChooseUs from "@/sections/WhyChooseUs";
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
        title="Building Digital Solutions That Drive Growth"
        description="We are a technology company dedicated to delivering innovative, scalable, and reliable software solutions for businesses worldwide."
        image="/about.png"
        imageAlt="The Zyllo Tech team at work"
      />
      <Reveal>
        <OurStory />
      </Reveal>
      <Reveal>
        <WhyChooseUs />
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
          heading="Let's Build Something Great Together"
          description="Whether you're launching a new product or scaling an existing one, we're here to help bring your vision to life."
          buttonLabel="Start Your Project"
        />
      </Reveal>
    </>
  );
}
