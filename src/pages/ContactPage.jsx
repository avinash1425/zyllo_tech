import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import ContactForm from "@/sections/ContactForm";
import WhyWorkWithUs from "@/sections/WhyWorkWithUs";
import Reveal from "@/components/Reveal";

export default function ContactPage() {
  return (
    <>
      <SEOHead
        title="Contact | Zyllo Tech"
        description="Get in touch with Zyllo Tech to discuss your next web, mobile, AI, or cloud project."
        canonical="/contact"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Contact", url: `${SITE_URL}/contact` },
        ])}
      />
      <PageHero
        breadcrumbLabel="Contact"
        eyebrow="Contact"
        title="Let's talk about your project"
        description="Reach out however works best for you, or fill out the form below and we'll get back to you within one business day."
        image="https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1920&q=70&auto=format"
        imageAlt="Team having a conversation about a project"
      />
      <Reveal>
        <ContactForm />
      </Reveal>
      <Reveal>
        <WhyWorkWithUs />
      </Reveal>
    </>
  );
}
