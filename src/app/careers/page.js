import PageHero from "@/components/PageHero";
import WhyJoinZyllo from "@/sections/WhyJoinZyllo";
import LifeAtZyllo from "@/sections/LifeAtZyllo";
import OpenPositions from "@/sections/OpenPositions";
import HiringProcess from "@/sections/HiringProcess";
import EmployeeBenefits from "@/sections/EmployeeBenefits";
import TalentNetworkCTA from "@/sections/TalentNetworkCTA";
import Reveal from "@/components/Reveal";

export const metadata = {
  title: "Careers | Zyllo Tech",
  description:
    "Join the team building software at Zyllo Tech. Explore open roles, life at the company, and the benefits of working with us.",
};

export default function CareersPage() {
  return (
    <>
      <PageHero
        eyebrow="Careers"
        title="Build what's next, with people who care about the craft"
        description="We're a small, senior team looking for people who want real ownership over the work they do."
        image="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1920&q=80"
        imageAlt="Team collaborating in a workshop session"
      />
      <Reveal>
        <WhyJoinZyllo />
      </Reveal>
      <Reveal>
        <LifeAtZyllo />
      </Reveal>
      <Reveal>
        <OpenPositions />
      </Reveal>
      <Reveal>
        <HiringProcess />
      </Reveal>
      <Reveal>
        <EmployeeBenefits />
      </Reveal>
      <Reveal>
        <TalentNetworkCTA />
      </Reveal>
    </>
  );
}
