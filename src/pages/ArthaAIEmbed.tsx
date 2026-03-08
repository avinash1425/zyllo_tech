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
      {/* pt accounts for fixed Navbar (TopBar ~32px + Header ~56px) */}
      <iframe
        src="/arthaai/index.html?embed=1"
        title="ArthaAI — Smart Money Guidance for Every Indian"
        className="flex-1 w-full border-none"
        style={{ marginTop: "calc(var(--navbar-h, 88px))", minHeight: "calc(100dvh - var(--navbar-h, 88px))" }}
        allow="fullscreen"
      />
    </div>
  );
};

export default ArthaAIEmbed;
