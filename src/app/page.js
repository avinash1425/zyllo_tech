import Hero from "@/sections/Hero";
import About from "@/sections/About";
import Services from "@/sections/Services";
import WhyChooseUs from "@/sections/WhyChooseUs";
import Process from "@/sections/Process";
import Industries from "@/sections/Industries";
import ContactCTA from "@/sections/ContactCTA";
import Reveal from "@/components/Reveal";

export default function Home() {
  return (
    <>
      <Hero />
      <Reveal>
        <About />
      </Reveal>
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
        <Industries tint="tint" />
      </Reveal>
      <Reveal>
        <ContactCTA />
      </Reveal>
    </>
  );
}
