import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import AboutUsSection from "@/components/ui/about-us-section";

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
      <AboutUsSection />
      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default AboutPage;
