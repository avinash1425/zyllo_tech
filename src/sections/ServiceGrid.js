"use client";

import Image from "next/image";
import Link from "next/link";

const SERVICES = [
  {
    image: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80",
    title: "Product Strategy & Consulting",
    description:
      "Discovery workshops, feasibility studies, and roadmap planning to turn ideas into a clear path to build.",
  },
  {
    image: "https://images.unsplash.com/photo-1547658719-da2b51169166?w=600&q=80",
    title: "Web Development",
    description:
      "Modern, responsive web applications built for performance and built to handle growth.",
  },
  {
    image: "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=600&q=80",
    title: "Mobile App Development",
    description:
      "Native and cross-platform apps designed around how your users actually behave.",
  },
  {
    image: "https://images.unsplash.com/photo-1559028006-448665bd7c7f?w=600&q=80",
    title: "UI/UX Design",
    description:
      "Interfaces designed around real usability testing, built to convert and easy to navigate.",
  },
  {
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=600&q=80",
    title: "Cloud Solutions",
    description:
      "Secure, scalable infrastructure so your application performs reliably as usage grows.",
  },
  {
    image: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&q=80",
    title: "AI Solutions",
    description:
      "Practical AI features, copilots, and automation that solve real workflow problems — not novelty add-ons.",
  },
  {
    image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=600&q=80",
    title: "Maintenance & Support",
    description:
      "24/7 monitoring, bug fixes, and performance tuning that keep your product healthy long after launch.",
  },
  {
    image: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=600&q=80",
    title: "Cybersecurity Engineering",
    description:
      "Security-first delivery with OWASP-aligned practices and compliance-ready controls.",
  },
  {
    image: "https://images.unsplash.com/photo-1516110833967-0b5716ca1387?w=600&q=80",
    title: "Quality Engineering & QA",
    description:
      "Automated testing and structured QA so issues get caught long before your users do.",
  },
];

export default function ServiceGrid() {
  return (
    <section className="relative overflow-hidden bg-[#fafbfc] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            What We Build
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            End-to-end software services under one roof
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            From first idea to long-term support, our team covers every stage
            of building and running modern software.
          </p>
        </div>
      </div>

      <div className="marquee-mask relative mt-12 overflow-hidden">
        <div className="marquee-track flex w-max gap-6 px-6">
          {[...SERVICES, ...SERVICES].map((service, index) => (
            <Link
              key={`${service.title}-${index}`}
              href="/services"
              className="group relative h-56 w-72 shrink-0 overflow-hidden rounded-2xl shadow-sm transition-shadow duration-300 hover:shadow-lg sm:w-80"
            >
              <Image
                src={service.image}
                alt={service.title}
                fill
                sizes="320px"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <h3 className="text-lg font-semibold text-white">{service.title}</h3>
                <p className="mt-1 text-sm text-white/80">{service.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <style jsx>{`
        .marquee-mask {
          -webkit-mask-image: linear-gradient(
            to right,
            transparent,
            black 5%,
            black 95%,
            transparent
          );
          mask-image: linear-gradient(
            to right,
            transparent,
            black 5%,
            black 95%,
            transparent
          );
        }
        .marquee-track {
          animation: marqueeScroll 50s linear infinite;
        }
        .marquee-mask:hover .marquee-track {
          animation-play-state: paused;
        }
        @keyframes marqueeScroll {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </section>
  );
}
