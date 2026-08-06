import PageHero from "@/components/PageHero";
import FeaturedProjects from "@/sections/FeaturedProjects";
import Process from "@/sections/Process";
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
        image="https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1920&q=80"
        imageAlt="Product dashboard and analytics on screen"
      />
      <Reveal>
        <FeaturedProjects />
      </Reveal>
      <Reveal>
        <Process />
      </Reveal>
    </>
  );
}
