import PageHero from "@/components/PageHero";
import FeaturedProjects from "@/sections/FeaturedProjects";
import PortfolioTechnologies from "@/sections/PortfolioTechnologies";
import WhyOurSolutions from "@/sections/WhyOurSolutions";
import Reveal from "@/components/Reveal";

export const metadata = {
  title: "Portfolio | Zyllo Tech",
  description:
    "A look at the kind of web, mobile, AI, and cloud projects Zyllo Tech builds — from featured work to case studies and our development process.",
};

export default function PortfolioPage() {
  return (
    <>
      <PageHero
        eyebrow="Our Work"
        title="A look at what we build"
        description="From early-stage MVPs to platforms serving thousands of users, here's the kind of work our team takes on."
        image="/protfolio.png"
        imageAlt="Zyllo Tech portfolio of work"
        primaryCta={{ label: "Start Your Project", href: "/contact" }}
        secondaryCta={{ label: "Contact Us", href: "/contact" }}
      />
      <Reveal>
        <FeaturedProjects />
      </Reveal>
      <Reveal>
        <PortfolioTechnologies />
      </Reveal>
      <Reveal>
        <WhyOurSolutions />
      </Reveal>
    </>
  );
}
