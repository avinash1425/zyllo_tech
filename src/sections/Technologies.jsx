import { CompatImage as Image } from "@/components/NextCompat";
import { BarChart3, Brain, Code2, Layers, Megaphone, Smartphone, Users, Wrench } from "lucide-react";

// Third direction for this section — the marquee didn't land either, so
// this drops the stage full-bleed (edge to edge, breaking out of the
// page's max-w-7xl column) and flanks the orbit with what we actually
// deliver, not just a chip cloud of tool names. 12 items at an even 30°
// spacing (was 9 at 40°) so Data/AI/Marketing tooling has room without
// crowding the ring.
const ORBIT_ITEMS = [
  { label: "React", angle: 0 },
  { label: "Next.js", angle: 30 },
  { label: "Node.js", angle: 60 },
  { label: "Python", angle: 90 },
  { label: "AWS", angle: 120 },
  { label: "Docker", angle: 150 },
  { label: "MongoDB", angle: 180 },
  { label: "React Native", angle: 210 },
  { label: "OpenAI", angle: 240 },
  { label: "TensorFlow", angle: 270 },
  { label: "Power BI", angle: 300 },
  { label: "Google Analytics", angle: 330 },
];

const LEFT_CAPABILITIES = [
  {
    icon: Code2,
    title: "Frontend Development",
    description: "Fast, accessible interfaces built with modern frameworks.",
    chips: ["React", "Next.js", "TypeScript", "Tailwind CSS", "Vue.js"],
    accent: "#f96706",
  },
  {
    icon: Layers,
    title: "Backend Development",
    description: "Scalable APIs and cloud infrastructure that hold up under load.",
    chips: ["Node.js", "Python", "Java", "GraphQL", ".NET", "AWS", "Docker"],
    accent: "#3089a6",
  },
  {
    icon: Smartphone,
    title: "Mobile App Development",
    description: "Native-quality apps for iOS and Android from one codebase.",
    chips: ["React Native", "Flutter", "Swift", "Kotlin"],
    accent: "#f96706",
  },
  {
    icon: Users,
    title: "CRM Development",
    description: "Custom CRM builds and integrations that fit how your team actually sells.",
    chips: ["Zoho CRM", "Salesforce", "HubSpot", "Custom Workflows"],
    accent: "#3089a6",
  },
];

const RIGHT_CAPABILITIES = [
  {
    icon: Megaphone,
    title: "Digital Marketing",
    description: "SEO, paid campaigns, and content strategy that bring the right traffic in.",
    chips: ["SEO", "Google Ads", "Meta Ads", "Content Strategy"],
    accent: "#f96706",
  },
  {
    icon: BarChart3,
    title: "Data Analytics",
    description: "Turning raw data into decisions leadership can actually act on.",
    chips: ["Data Analytics", "Power BI", "Google Analytics", "Dashboards"],
    accent: "#3089a6",
  },
  {
    icon: Brain,
    title: "AI Development",
    description: "AI models and integrations built for a real business use case, not a demo.",
    chips: ["OpenAI", "LangChain", "TensorFlow", "Machine Learning"],
    accent: "#f96706",
  },
  {
    icon: Wrench,
    title: "Annual Maintenance Contracts",
    description: "Ongoing monitoring, patching, and support after launch.",
    chips: ["Monitoring", "Security Patches", "Performance Tuning", "SLA Support"],
    accent: "#f96706",
  },
];

function CapabilityCard({ icon: Icon, title, description, chips, accent }) {
  return (
    <div className="group flex gap-4">
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-110"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-[15px] font-bold text-[#0f172a]">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[#54607a]">{description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[11.5px] font-medium text-[#3a4453] shadow-sm backdrop-blur-sm"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Technologies({ tint = "tint" }) {
  const bg = tint === "tint" ? "bg-[#fafbfc]" : "bg-white";
  return (
    <section className={`relative overflow-hidden border-t border-[#e2e5ea] ${bg} pt-14 lg:pt-18`}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            Technologies
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#0f172a] sm:text-4xl">
            A modern stack, chosen{" "}
            <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
              deliberately
            </span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#54607a] sm:text-lg">
            We choose the right technology for your business requirements —
            not just what&apos;s trending.
          </p>
        </div>
      </div>

      {/* Full-bleed light stage — a soft blend of the logo's orange and
          blue, breaking out of the max-w-7xl column edge to edge. */}
      <div className="relative mt-12 w-full overflow-hidden bg-gradient-to-br from-[#fff3e6] via-[#f7f9fb] to-[#e9f2f6] py-14 lg:py-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-16 h-64 w-64 rounded-full bg-[#3089a6] opacity-[0.1] blur-[100px]" />
          <div className="absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-[#f96706] opacity-[0.1] blur-[100px]" />
        </div>

        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-10 lg:px-8">
          <div className="flex flex-col gap-8">
            {LEFT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>

          {/* Orbit — logo sits in the hub instead of a text label. Sized up
              (was 260/300/320) with a smaller radius and tighter label
              padding so labels have real clearance from the ring instead
              of touching it. */}
          <div className="relative mx-auto flex aspect-square w-[300px] shrink-0 items-center justify-center sm:w-[380px] lg:w-[440px]">
            <div aria-hidden="true" className="absolute inset-0 rounded-full border border-[#0f172a]/10" />
            <div aria-hidden="true" className="absolute inset-10 rounded-full border border-[#0f172a]/5" />

            <div className="orbit-spin absolute inset-0">
              {ORBIT_ITEMS.map(({ label, angle }, index) => {
                const accent = index % 2 === 0 ? "#f96706" : "#3089a6";
                const radius = 35;
                const x = 50 + radius * Math.cos((angle * Math.PI) / 180);
                const y = 50 + radius * Math.sin((angle * Math.PI) / 180);
                return (
                  <div
                    key={label}
                    className="orbit-counter-spin absolute flex flex-col items-center gap-1.5"
                    style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                  >
                    <span
                      className="h-2 w-2 rounded-full shadow-lg"
                      style={{ backgroundColor: accent, boxShadow: `0 0 10px ${accent}66` }}
                      aria-hidden="true"
                    />
                    <span
                      className="whitespace-nowrap rounded-full border border-white/70 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-[#3a4453] shadow-sm backdrop-blur-sm"
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Hub — the actual logo, on a white card for guaranteed
                contrast against the dark stage, same technique as the
                footer's logo treatment. */}
            <div className="relative rounded-full bg-gradient-to-br from-[#f96706] to-[#3089a6] p-[3px] shadow-xl shadow-black/30">
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white p-4 sm:h-32 sm:w-32 lg:h-36 lg:w-36">
                <Image
                  src="/zyllo-logo-nav.png"
                  alt="Zyllo Tech Software Solutions Private Limited"
                  width={400}
                  height={80}
                  className="h-auto w-full"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-8">
            {RIGHT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .orbit-spin {
          animation: orbitSpin 40s linear infinite;
        }
        .orbit-counter-spin {
          animation: orbitCounterSpin 40s linear infinite;
        }
        @keyframes orbitSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes orbitCounterSpin {
          from {
            transform: translate(-50%, -50%) rotate(0deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(-360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .orbit-spin,
          .orbit-counter-spin {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
