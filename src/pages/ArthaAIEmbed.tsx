import Navbar from "@/components/Navbar";
import SEOHead from "@/components/SEOHead";

// Bundle everything at build time so zero external requests are needed.
// CSS and JS are inlined directly — no CDN/hosting can intercept them.
import rawHtml from "../../arthaai/index.html?raw";
import rawCss  from "../../arthaai/css/style.css?raw";
import rawJs   from "../../arthaai/js/main.js?raw";

const srcDoc = rawHtml
  // Replace the external stylesheet link with an inline <style> block
  .replace(
    '<link rel="stylesheet" href="css/style.css">',
    `<style>\n${rawCss}\n</style>`
  )
  // Replace the external script tag with an inline <script> block
  .replace(
    '<script src="js/main.js"></script>',
    `<script>\n${rawJs}\n</script>`
  )
  // Keep <base> so inter-page links (calculators.html etc.)
  // still resolve correctly when the user navigates inside the iframe
  .replace("<head>", '<head>\n  <base href="/arthaai/">');

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
