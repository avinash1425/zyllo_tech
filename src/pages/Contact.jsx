import Seo from "@/components/Seo";
import PageHero from "@/components/PageHero";
import ContactForm from "@/sections/ContactForm";
import WhyWorkWithUs from "@/sections/WhyWorkWithUs";
import Reveal from "@/components/Reveal";

export default function ContactPage() {
  return (
    <>
      <Seo 
        title="Contact"
        description="Get in touch with Zyllo Tech to discuss your next web, mobile, AI, or cloud project."
        path="/contact"
       />
      <PageHero
        breadcrumbLabel="Contact"
        eyebrow="Contact"
        title="Let's talk about your project"
        description="Reach out however works best for you, or fill out the form below and we'll get back to you within one business day."
        image="https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1920&q=80"
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
