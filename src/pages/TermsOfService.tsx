import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: "By accessing or using this website, you agree to these Terms of Service and all applicable laws. If you do not agree, please discontinue use of this site.",
  },
  {
    title: "2. Website Use",
    body: "You agree to use this website lawfully and not attempt to disrupt services, gain unauthorized access, or misuse content, forms, APIs, or security features.",
  },
  {
    title: "3. Intellectual Property",
    body: "All website content, branding, text, graphics, code, and related materials are owned by Zyllo Tech or its licensors unless otherwise stated. Unauthorized copying, distribution, or derivative use is prohibited.",
  },
  {
    title: "4. Service Information",
    body: "Website information is provided for general informational purposes and may change without notice. Project scope, pricing, and delivery commitments are governed by separate signed agreements.",
  },
  {
    title: "5. Third-Party Links",
    body: "This website may include links to third-party platforms. We do not control third-party websites and are not responsible for their content, policies, or practices.",
  },
  {
    title: "6. Disclaimer",
    body: "This site is provided on an as is and as available basis. To the maximum extent permitted by law, we disclaim warranties of merchantability, fitness for a particular purpose, and non-infringement.",
  },
  {
    title: "7. Limitation of Liability",
    body: "To the extent permitted by law, Zyllo Tech will not be liable for indirect, incidental, special, or consequential damages arising from use of this website or inability to use it.",
  },
  {
    title: "8. Indemnification",
    body: "You agree to indemnify and hold harmless Zyllo Tech from claims, losses, and liabilities resulting from your violation of these terms or misuse of the website.",
  },
  {
    title: "9. Governing Law",
    body: "These terms are governed by applicable laws in India. Any disputes are subject to the competent courts and legal framework of India, unless otherwise agreed in writing.",
  },
  {
    title: "10. Changes to Terms",
    body: "We may modify these terms at any time. Updated terms become effective upon posting. Continued website use indicates acceptance of the revised terms.",
  },
  {
    title: "11. Contact",
    body: "For legal or policy questions, contact us at info@zyllotech.com.",
  },
];

const TermsOfService = () => {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Terms of Service | Zyllo Tech"
        description="Read the terms and conditions governing use of the Zyllo Tech website and digital properties. Understand your rights and responsibilities as a visitor."
        canonical="/terms-of-service"
        keywords="Zyllo Tech terms of service, website terms, conditions of use, legal terms"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Terms of Service", url: `${SITE_URL}/terms-of-service` },
        ])}
      />
      <Navbar />
      <PageHero
        title="Terms of"
        highlight="Service"
        description="Conditions governing use of Zyllo Tech website and digital properties."
        breadcrumb="Terms of Service"
      />

      <section className="py-14">
        <div className="container mx-auto max-w-4xl px-4 sm:px-6">
          <div className="space-y-7">
            {sections.map((section) => (
              <article key={section.title}>
                <h2 className="text-lg font-semibold text-foreground sm:text-xl">{section.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">{section.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default TermsOfService;
