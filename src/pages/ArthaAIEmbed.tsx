import Navbar from "@/components/Navbar";
import SEOHead from "@/components/SEOHead";

// Bundle the HTML at build time — the hosting can never 404 it.
// Injecting <base href="/arthaai/"> makes all relative paths
// (css/style.css, js/main.js, calculators.html …) resolve to /arthaai/*
// on the same origin. Files with explicit extensions (.css .js .html)
// are always served directly by the CDN without hitting the SPA catch-all.
import rawHtml from "../../arthaai/index.html?raw";

const srcDoc = rawHtml.replace("<head>", '<head>\n  <base href="/arthaai/">');

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
        srcDoc={srcDoc}
        title="ArthaAI — Smart Money Guidance for Every Indian"
        className="flex-1 w-full border-none"
        style={{ minHeight: 0 }}
        allow="fullscreen"
      />
    </div>
  );
};

export default ArthaAIEmbed;
