import PageHero from "@/components/PageHero";
import FeaturedArticle from "@/sections/FeaturedArticle";
import LatestArticles from "@/sections/LatestArticles";
import Newsletter from "@/sections/Newsletter";
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
        breadcrumbLabel="Blog"
        eyebrow="Blog"
        title="Ideas, lessons, and notes from the team"
        description="Practical writing on engineering, design, and building software that lasts — not just theory."
        image="/blog.png"
        imageAlt="Zyllo Tech blog"
      />
      <Reveal>
        <FeaturedArticle />
      </Reveal>
      <Reveal>
        <LatestArticles />
      </Reveal>
      <Reveal>
        <Newsletter />
      </Reveal>
    </>
  );
}
