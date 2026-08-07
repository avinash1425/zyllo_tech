import PageHero from "@/components/PageHero";
import Industries from "@/sections/Industries";
import ChallengesSolutions from "@/sections/ChallengesSolutions";
import SolutionsWeDeliver from "@/sections/SolutionsWeDeliver";
import ContactCTA from "@/sections/ContactCTA";
import Reveal from "@/components/Reveal";

export const metadata = {
  title: "Industries | Zyllo Tech",
  description:
    "Zyllo Tech builds software for startups, healthcare, finance, retail, logistics, and more — solutions shaped around how each industry actually works.",
};

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        eyebrow="Industries"
        title="Software shaped around how your industry actually works"
        description="Every sector has its own rules, risks, and workflows. We bring the right context to every engagement, not a one-size-fits-all build."
        image="https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1920&q=80"
        imageAlt="Team reviewing industry-specific data and analytics"
      />
      <Reveal>
        <Industries
          tint="tint"
          eyebrow="Industries We Serve"
          heading="Supporting Businesses Across Multiple Sectors"
          description="Our expertise spans a wide range of industries, delivering solutions designed to meet specific business requirements."
        />
      </Reveal>
      <Reveal>
        <ChallengesSolutions />
      </Reveal>
      <Reveal>
        <SolutionsWeDeliver />
      </Reveal>
      <Reveal>
        <ContactCTA
          heading="Don't see your industry listed?"
          description="Chances are we've solved something close to it. Let's talk about your specific challenge."
          buttonLabel="Discuss Your Industry"
        />
      </Reveal>
    </>
  );
}
