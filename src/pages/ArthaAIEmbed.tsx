import Navbar from "@/components/Navbar";
import SEOHead from "@/components/SEOHead";

const ArthaAIEmbed = () => {
  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      <SEOHead
        title="ArthaAI — Smart Money Guidance for Every Indian"
        description="India's first AI-powered personal finance platform — multilingual, unbiased, and built for Bharat."
        canonical="/arthaai"
      />
      <Navbar />
      <iframe
        src="/arthaai/index.html"
        title="ArthaAI — Smart Money Guidance for Every Indian"
        className="flex-1 w-full border-none"
        style={{ minHeight: 0 }}
        allow="fullscreen"
      />
    </div>
  );
};

export default ArthaAIEmbed;
