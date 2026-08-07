"use client";

import Image from "next/image";
import Link from "next/link";

const INDUSTRIES = [
  {
    image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&q=80",
    title: "Startups & SaaS",
    description: "Scalable products, MVPs, and SaaS platforms built for rapid growth.",
  },
  {
    image: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&q=80",
    title: "Healthcare",
    description: "Secure healthcare applications, patient management systems, and telehealth solutions.",
  },
  {
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&q=80",
    title: "Finance & FinTech",
    description: "Reliable financial platforms with secure transactions and regulatory compliance.",
  },
  {
    image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&q=80",
    title: "E-Commerce & Retail",
    description: "Online stores, inventory management, payment integration, and customer engagement solutions.",
  },
  {
    image: "https://images.unsplash.com/photo-1565043666747-69f6646db940?w=600&q=80",
    title: "Manufacturing",
    description: "Smart manufacturing systems that improve productivity and operational efficiency.",
  },
  {
    image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=600&q=80",
    title: "Education",
    description: "Learning management systems, e-learning platforms, and educational portals.",
  },
  {
    image: "https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=600&q=80",
    title: "Banking",
    description: "Digital banking solutions, customer portals, and secure financial applications.",
  },
  {
    image: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&q=80",
    title: "Real Estate",
    description: "Property management platforms, listing portals, and real estate business solutions.",
  },
  {
    image: "https://images.unsplash.com/photo-1494412651409-8963ce7935a7?w=600&q=80",
    title: "Logistics & Transportation",
    description: "Fleet management, shipment tracking, warehouse, and logistics automation.",
  },
  {
    image: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600&q=80",
    title: "Travel & Hospitality",
    description: "Booking systems, travel platforms, hotel management, and customer experience solutions.",
  },
  {
    image: "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=600&q=80",
    title: "Media & Entertainment",
    description: "Streaming platforms, content management systems, and digital media applications.",
  },
  {
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=600&q=80",
    title: "Telecommunications",
    description: "Telecom management systems, customer portals, and network management solutions.",
  },
  {
    image: "https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600&q=80",
    title: "Agriculture",
    description: "Smart farming, IoT monitoring, and agriculture management solutions.",
  },
  {
    image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&q=80",
    title: "Gaming",
    description: "Game backend services, multiplayer infrastructure, and gaming platforms.",
  },
];

export default function Industries({
  tint = "white",
  eyebrow = "Industries We Serve",
  heading = "Supporting Businesses Across Multiple Sectors",
  description = "Our expertise spans a wide range of industries, delivering solutions designed to meet specific business requirements.",
}) {
  const bg = tint === "tint" ? "bg-[#fafbfc]" : "bg-white";
  return (
    <section className={`relative overflow-hidden border-t border-[#e7e9ee] ${bg} py-6 lg:py-8`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            {eyebrow}
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            {heading}
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            {description}
          </p>
        </div>
      </div>

      <div className="marquee-mask relative mt-6 overflow-hidden">
        <div className="marquee-track flex w-max gap-6 px-6">
          {[...INDUSTRIES, ...INDUSTRIES].map((industry, index) => (
            <Link
              key={`${industry.title}-${index}`}
              href="/industries"
              className="group relative h-56 w-72 shrink-0 overflow-hidden rounded-2xl shadow-sm transition-shadow duration-300 hover:shadow-lg sm:w-80"
            >
              <Image
                src={industry.image}
                alt={industry.title}
                fill
                sizes="320px"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <h3 className="text-lg font-semibold text-white">{industry.title}</h3>
                <p className="mt-1 text-sm text-white/80">{industry.description}</p>
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
          animation: marqueeScroll 45s linear infinite;
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
