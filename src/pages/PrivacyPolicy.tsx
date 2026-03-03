import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";

const sections = [
  {
    title: "1. Information We Collect",
    body: "We may collect information you provide directly, including your name, email address, phone number, company information, and any details submitted through contact, career, or inquiry forms. We also collect basic technical data such as browser type, device information, IP address, and usage logs for security and analytics.",
  },
  {
    title: "2. How We Use Information",
    body: "We use your information to respond to inquiries, provide services, process applications, improve website performance, communicate project updates, and maintain security. We may also use aggregated analytics data to understand user behavior and optimize our content and platform experience.",
  },
  {
    title: "3. Cookies and Tracking",
    body: "We use essential cookies for core functionality and optional analytics or marketing cookies where enabled by your preferences. You can update your cookie settings from the cookie banner controls at any time.",
  },
  {
    title: "4. Data Sharing",
    body: "We do not sell personal information. We may share limited information with trusted service providers who help us operate our website, communications, and infrastructure. These providers are required to handle data securely and only for authorized purposes.",
  },
  {
    title: "5. Data Retention",
    body: "We retain personal information only for as long as needed for legitimate business purposes, legal compliance, dispute resolution, and service delivery. Retention periods may vary depending on the type of data and applicable obligations.",
  },
  {
    title: "6. Data Security",
    body: "We apply reasonable administrative, technical, and organizational safeguards to protect personal information from unauthorized access, alteration, disclosure, or destruction. No internet transmission is fully secure, but we continuously improve our controls and monitoring.",
  },
  {
    title: "7. Your Rights and Choices",
    body: "Depending on your jurisdiction, you may request access, correction, deletion, restriction, or portability of your personal information. You may also object to certain processing activities. To exercise these rights, contact us using the details below.",
  },
  {
    title: "8. International Data Transfers",
    body: "If information is transferred across regions, we apply appropriate safeguards and contractual protections consistent with applicable data protection requirements.",
  },
  {
    title: "9. Contact",
    body: "For privacy requests or concerns, contact us at info@zyllotech.com. We aim to respond within a reasonable time.",
  },
  {
    title: "10. Policy Updates",
    body: "We may update this Privacy Policy periodically. Changes become effective when posted on this page.",
  },
];

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="Privacy"
        highlight="Policy"
        description="How Zyllo Tech collects, uses, and protects information across our website and services."
        breadcrumb="Privacy Policy"
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

export default PrivacyPolicy;
