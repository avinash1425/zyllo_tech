import PageHero from "@/components/PageHero";
import WhyJoinZyllo from "@/sections/WhyJoinZyllo";
import OpenPositions from "@/sections/OpenPositions";
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
        breadcrumbLabel="Careers"
        eyebrow="Careers"
        title="Grow Your Career with Zyllo Tech"
        description="Join a team that values innovation, collaboration, and continuous learning while building technology that makes an impact."
        image="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1920&q=80"
        imageAlt="Team collaborating in a workshop session"
        primaryCta={{ label: "Apply for Job", href: "#open-positions" }}
      />
      <Reveal>
        <WhyJoinZyllo />
      </Reveal>
      <Reveal>
        <OpenPositions />
      </Reveal>
    </>
  );
}
