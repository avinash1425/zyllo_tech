import Navbar from "@/components/Navbar";
import SEOHead from "@/components/SEOHead";

const ArthaAIEmbed = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEOHead
        title="ArthaAI — Smart Money Guidance for Every Indian"
        description="India's first AI-powered personal finance platform — multilingual, unbiased, and built for Bharat."
        canonical="/arthaai"
      />
      <Navbar />
      {/* Top padding for fixed Navbar: TopBar(~32px) + Header(56px) = ~88px on desktop, ~56px on mobile */}
      <iframe
        src="/arthaai/index.html?embed=1"
        title="ArthaAI — Smart Money Guidance for Every Indian"
        className="w-full border-none flex-1 pt-0 mt-[88px] md:mt-[88px]"
        style={{ minHeight: "calc(100dvh - 88px)" }}
        allow="fullscreen"
      />
    </div>
  );
};

export default ArthaAIEmbed;
