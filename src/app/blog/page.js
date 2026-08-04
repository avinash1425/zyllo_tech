import PageHero from "@/components/PageHero";
import FeaturedArticle from "@/sections/FeaturedArticle";
import BlogCategories from "@/sections/BlogCategories";
import LatestArticles from "@/sections/LatestArticles";
import PopularTopics from "@/sections/PopularTopics";
import Newsletter from "@/sections/Newsletter";
import ContactCTA from "@/sections/ContactCTA";
import Reveal from "@/components/Reveal";

export const metadata = {
  title: "Blog | Zyllo Tech",
  description:
    "Practical notes on engineering, design, AI, and product strategy from the Zyllo Tech team.",
};

export default function BlogPage() {
  return (
    <>
      <PageHero
        eyebrow="Blog"
        title="Ideas, lessons, and notes from the team"
        description="Practical writing on engineering, design, and building software that lasts — not just theory."
        image="https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1920&q=80"
        imageAlt="Writing and planning notes on a desk"
      />
      <Reveal>
        <FeaturedArticle />
      </Reveal>
      <Reveal>
        <BlogCategories />
      </Reveal>
      <Reveal>
        <LatestArticles />
      </Reveal>
      <Reveal>
        <PopularTopics />
      </Reveal>
      <Reveal>
        <Newsletter />
      </Reveal>
      <Reveal>
        <ContactCTA />
      </Reveal>
    </>
  );
}
