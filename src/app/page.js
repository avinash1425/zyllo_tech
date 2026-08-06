import Hero from "@/sections/Hero";
import Services from "@/sections/Services";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Process from "@/sections/Process";
import About from "@/sections/About";
import ContactCTA from "@/sections/ContactCTA";
import Reveal from "@/components/Reveal";

export default function Home() {
  return (
    <>
      <Hero />
      <Reveal>
        <Services />
      </Reveal>
      <Reveal>
        <WhyChooseUs />
      </Reveal>
      <Reveal>
        <Process />
      </Reveal>
      <Reveal>
        <About />
      </Reveal>
      <Reveal>
        <ContactCTA
          heading="Ready to Build Your Next Project?"
          description="Let's create something amazing together."
          buttonLabel="Contact Us"
        />
      </Reveal>
    </>
  );
}
