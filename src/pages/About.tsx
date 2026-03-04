import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import AboutUsSection from "@/components/ui/about-us-section";
import { Component as AiLoader } from "@/components/ui/ai-loader";

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="About"
        highlight="Zyllo Tech"
        description="A software engineering company focused on reliable delivery, secure systems, and long-term product value."
        breadcrumb="About Us"
      />
      <section className="py-10 border-b border-border/70">
        <div className="container mx-auto px-6">
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <AiLoader className="mx-auto" label="Generating About Us" />
          </div>
        </div>
      </section>
      <AboutUsSection />
      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default AboutPage;
