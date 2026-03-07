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
    email: "info@zyllotech.com",
    priceRange: "$$",
    currenciesAccepted: "INR, USD",
    paymentAccepted: "Bank Transfer, Online",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Hyderabad",
      addressLocality: "Hyderabad",
      addressRegion: "Telangana",
      postalCode: "500001",
      addressCountry: "IN",
    },
    geo: { "@type": "GeoCoordinates", latitude: 17.385, longitude: 78.4867 },
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday"], opens: "09:00", closes: "18:00" },
    ],
    areaServed: [
      { "@type": "Country", name: "India" },
      { "@type": "Country", name: "United States" },
      { "@type": "Country", name: "United Arab Emirates" },
      { "@type": "Country", name: "United Kingdom" },
      { "@type": "Country", name: "Singapore" },
      { "@type": "Country", name: "Australia" },
      { "@type": "Country", name: "Canada" },
    ],
    sameAs: [
      "https://www.linkedin.com/company/zyllo-tech",
      "https://x.com/ZylloS85154",
      "https://www.instagram.com/zyllotechsoftwaresolutions/",
      "https://www.facebook.com/profile.php?id=61588192247341",
      "https://www.youtube.com/@zylloTechSoftwareSolutions",
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "5",
      ratingCount: "5",
      bestRating: "5",
      worstRating: "1",
    },
    review: [
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Rajesh Kumar" },
        reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
        name: "Outstanding fintech delivery",
        reviewBody: "Zyllo Tech delivered our core banking dashboard on time and beyond expectations. Their team's deep understanding of fintech requirements and attention to security best practices made the entire engagement seamless. We've seen a 40% improvement in operational efficiency.",
      },
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Priya Sharma" },
        reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
        name: "Transformed our healthcare workflow",
        reviewBody: "The patient management platform Zyllo Tech built for us transformed our workflow completely. Their AI-driven appointment scheduling alone reduced no-shows by 35%. The team was proactive, communicative, and genuinely invested in our success.",
      },
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Ahmed Al-Rashid" },
        reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
        name: "Exceptional cloud architecture for e-commerce",
        reviewBody: "We needed a scalable e-commerce platform capable of handling peak-season traffic spikes. Zyllo Tech's cloud architecture handled 10x our normal load without a hiccup during our biggest sale event. Exceptional engineering team.",
      },
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Sanjay Mehta" },
        reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
        name: "28% logistics cost reduction",
        reviewBody: "Zyllo Tech's real-time fleet tracking and route optimization solution cut our delivery costs by 28%. The mobile app they built for our drivers is intuitive and has dramatically improved on-ground efficiency.",
      },
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Li Wei" },
        reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
        name: "EdTech platform with 60% engagement boost",
        reviewBody: "Building an interactive learning platform with live classes, assessments, and progress tracking seemed daunting. Zyllo Tech made it effortless. Our student engagement rates jumped by 60% within the first month of launch.",
      },
    ],
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
