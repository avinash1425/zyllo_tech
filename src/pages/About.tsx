import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import AboutUsSection from "@/components/ui/about-us-section";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="About Zyllo Tech | Software Engineering Company Hyderabad India"
        description="Zyllo Tech is a software engineering company based in Hyderabad, India. We deliver reliable, secure, and scalable software products — web apps, mobile apps, AI solutions, and cloud engineering — for enterprises across India and 15+ countries."
        canonical="/about"
        keywords="about Zyllo Tech, software company Hyderabad, software engineering company India, IT company Hyderabad, software outsourcing India, enterprise software company"
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "About Us", url: `${SITE_URL}/about` },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "AboutPage",
            name: "About Zyllo Tech",
            url: `${SITE_URL}/about`,
            description: "Learn about Zyllo Tech — our mission, engineering culture, and delivery approach.",
            publisher: { "@type": "Organization", name: "Zyllo Tech", url: SITE_URL },
          },
        ]}
      />
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
