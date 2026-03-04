import Navbar from "@/components/Navbar";
import GlobeScrollDemo from "@/components/ui/landing-page";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import CookieConsent from "@/components/CookieConsent";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const homeStructuredData = [
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${SITE_URL}/#localbusiness`,
    name: "Zyllo Tech Software Solutions Pvt. Ltd.",
    url: SITE_URL,
    telephone: "+91-70757-73680",
    email: "hello@zyllotech.com",
    priceRange: "$$",
    currenciesAccepted: "INR, USD",
    paymentAccepted: "Bank Transfer, Online",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Hyderabad",
      addressRegion: "Telangana",
      postalCode: "500001",
      addressCountry: "IN",
    },
    geo: { "@type": "GeoCoordinates", latitude: 17.385, longitude: 78.4867 },
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday"], opens: "09:00", closes: "18:00" },
    ],
    serviceArea: { "@type": "GeoShape", description: "India, USA, UAE, UK, Singapore, Australia, Canada" },
    sameAs: ["https://www.linkedin.com/company/zyllotech"],
  },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <SEOHead
        title="Zyllo Tech | Software Development, AI & Cloud Engineering Company India"
        description="Zyllo Tech is a software engineering company in Hyderabad, India delivering enterprise web & mobile apps, AI/ML solutions, cloud DevOps, cybersecurity, and QA for businesses across India, USA, UAE, UK, and globally."
        canonical="/"
        keywords="software development company India, software company Hyderabad, AI solutions India, mobile app development India, cloud engineering, web application development, enterprise software, software outsourcing India"
        structuredData={homeStructuredData}
      />
      <Navbar />
      <main className="pt-[100px]">
        <GlobeScrollDemo />
      </main>
      <Footer />
      <FloatingButtons />
      <CookieConsent />
    </div>
  );
};

export default Index;
