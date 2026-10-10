import Seo from "@/components/Seo";
import PageHero from "@/components/PageHero";
import ContactForm from "@/sections/ContactForm";
import OfficeLocation from "@/sections/OfficeLocation";
import ContactMethods from "@/sections/ContactMethods";
import Reveal from "@/components/Reveal";

export default function ContactPage() {
  return (
    <>
      <Seo 
        title="Contact Us: Start Your Software or AI Project"
        description="Talk to Zyllo Tech about your custom software, web, mobile app or AI project. Based in Guntur, India, working remotely worldwide. Reply within one business day."
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
      <ContactMethods />
      <Reveal>
        <ContactForm />
      </Reveal>
      <Reveal>
        <OfficeLocation />
      </Reveal>
    </>
  );
}
