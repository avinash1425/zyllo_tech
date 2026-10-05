import Seo from "@/components/Seo";
import PageHero from "@/components/PageHero";
import FeaturedArticle from "@/sections/FeaturedArticle";
import LatestArticles from "@/sections/LatestArticles";
import Newsletter from "@/sections/Newsletter";
import Reveal from "@/components/Reveal";

export default function BlogPage() {
  return (
    <>
      <Seo 
        title="Blog"
        description="Practical notes on engineering, design, AI, and product strategy from the Zyllo Tech team."
        path="/blog"
       />
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
