"use client";

import Image from "next/image";
import Link from "next/link";

const SERVICES = [
  {
    image: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80",
    title: "Product Strategy & Consulting",
    description:
      "Discovery workshops, technical feasibility studies, MVP scoping, and roadmap planning to turn ideas into a clear path to build.",
  },
  {
    image: "https://images.unsplash.com/photo-1547658719-da2b51169166?w=800&q=80",
    title: "Web Development",
    description:
      "Modern, responsive and scalable web applications built with the latest technologies.",
  },
  {
    image: "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=800&q=80",
    title: "Mobile App Development",
    description:
      "Native and cross platform mobile applications designed for exceptional user experiences.",
  },
  {
    image: "https://images.unsplash.com/photo-1559028006-448665bd7c7f?w=800&q=80",
    title: "UI/UX Design",
    description:
      "Beautiful interfaces focused on usability, accessibility and business growth.",
  },
  {
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&q=80",
    title: "Cloud Solutions",
    description:
      "Secure cloud infrastructure, deployment and scalable backend architecture.",
  },
  {
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80",
    title: "AI Solutions",
    description:
      "Intelligent AI powered applications and automation that improve productivity.",
  },
  {
    image: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80",
    title: "Maintenance & Support",
    description:
      "Continuous monitoring, maintenance and technical support for your applications.",
  },
  {
    image: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&q=80",
    title: "Cybersecurity Engineering",
    description:
      "Security-first delivery with OWASP-aligned practices, threat modeling, vulnerability management, and compliance-ready controls.",
  },
  {
    image: "https://images.unsplash.com/photo-1516110833967-0b5716ca1387?w=800&q=80",
    title: "Quality Engineering & QA",
    description:
      "Automated test suites, shift-left testing, performance validation, and structured QA processes across web, mobile, and APIs.",
  },
];

function ServiceCard({ image, title, description }) {
  return (
    <Link
      href="/services"
      className="group relative h-56 w-72 shrink-0 overflow-hidden rounded-2xl shadow-sm transition-shadow duration-300 hover:shadow-lg sm:w-80"
    >
      <Image
        src={image}
        alt={title}
        fill
        sizes="320px"
        className="object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-white/80">{description}</p>
      </div>
    </Link>
  );
}

export default function Services() {
  return (
    <section className="relative overflow-hidden bg-white py-12 lg:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 right-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            What We Build
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Building Digital Experiences That Drive Business Growth
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We create scalable digital solutions that help businesses
            innovate, streamline operations, and deliver exceptional customer
            experiences.
          </p>
        </div>
      </div>

      <div className="marquee-mask relative mt-12 overflow-hidden">
        <div className="marquee-track flex w-max gap-6 px-6">
          {[...SERVICES, ...SERVICES].map((service, index) => (
            <ServiceCard key={`${service.title}-${index}`} {...service} />
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
