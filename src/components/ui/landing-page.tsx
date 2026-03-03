import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Globe from "@/components/ui/globe";
import TubesBackground from "@/components/ui/neon-flow";
import { cn } from "@/lib/utils";

interface ScrollGlobeProps {
  sections: {
    id: string;
    badge?: string;
    title: string;
    subtitle?: string;
    description: string;
    align?: "left" | "center" | "right";
    features?: { title: string; description: string }[];
    actions?: { label: string; variant: "primary" | "secondary"; onClick?: () => void }[];
  }[];
  globeConfig?: {
    positions: {
      top: string;
      left: string;
      scale: number;
    }[];
  };
  className?: string;
}

const defaultGlobeConfig = {
  positions: [{ top: "48%", left: "78%", scale: 1.2 }],
};

const heroSignals = ["Agent", "Automation", "Cloud Native"];
const parsePercent = (str: string): number => parseFloat(str.replace("%", ""));

function ScrollGlobe({ sections, globeConfig = defaultGlobeConfig, className }: ScrollGlobeProps) {
  const [activeSection, setActiveSection] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [globeTransform, setGlobeTransform] = useState("");
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const animationFrameId = useRef<number>();

  const calculatedPositions = useMemo(
    () =>
      globeConfig.positions.map((pos) => ({
        top: parsePercent(pos.top),
        left: parsePercent(pos.left),
        scale: pos.scale,
      })),
    [globeConfig.positions]
  );

  const updateScrollPosition = useCallback(() => {
    const scrollTop = window.pageYOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    setScrollProgress(Math.min(Math.max(scrollTop / docHeight, 0), 1));

    const viewportCenter = window.innerHeight / 2;
    let nextActive = 0;
    let minDistance = Number.POSITIVE_INFINITY;

    sectionRefs.current.forEach((ref, index) => {
      if (!ref) return;
      const rect = ref.getBoundingClientRect();
      const sectionCenter = rect.top + rect.height / 2;
      const distance = Math.abs(sectionCenter - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        nextActive = index;
      }
    });
    setActiveSection(nextActive);
  }, []);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      animationFrameId.current = requestAnimationFrame(() => {
        updateScrollPosition();
        ticking = false;
      });
      ticking = true;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    updateScrollPosition();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [updateScrollPosition]);

  useEffect(() => {
    const fixed = calculatedPositions[0];
    if (!fixed) return;
    setGlobeTransform(
      `translate3d(${fixed.left}vw, ${fixed.top}vh, 0) translate3d(-50%, -50%, 0) scale3d(${fixed.scale}, ${fixed.scale}, 1)`
    );
  }, [calculatedPositions]);

  return (
    <div className={cn("relative min-h-screen w-full overflow-x-hidden bg-background text-foreground", className)}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-[10%] h-72 w-72 rounded-full bg-primary/18 blur-3xl" />
        <div className="absolute top-[32%] right-[4%] h-80 w-80 rounded-full bg-[hsl(195,55%,42%,0.15)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(215 14% 87%) 1px, transparent 1px), linear-gradient(to bottom, hsl(215 14% 87%) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="fixed left-0 top-0 z-50 h-0.5 w-full bg-border/30">
        <div
          className="h-full bg-gradient-to-r from-primary via-[hsl(24,90%,58%)] to-[hsl(195,55%,42%)]"
          style={{
            transform: `scaleX(${scrollProgress})`,
            transformOrigin: "left center",
            transition: "transform 120ms ease-out",
          }}
        />
      </div>

      <div className="fixed right-3 top-1/2 z-40 hidden -translate-y-1/2 sm:flex lg:right-6">
        <div className="space-y-4">
          {sections.map((section, index) => (
            <button
              key={section.id}
              onClick={() => sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className={cn(
                "h-2.5 w-2.5 rounded-full border-2 transition-all duration-300 hover:scale-125",
                activeSection === index
                  ? "border-primary bg-primary shadow-[0_0_14px_hsl(24_95%_50%_/_0.45)]"
                  : "border-muted-foreground/40 bg-transparent hover:border-primary/60 hover:bg-primary/10"
              )}
              aria-label={`Go to ${section.badge || `section ${index + 1}`}`}
            />
          ))}
        </div>
      </div>

      <div
        className="fixed z-10 pointer-events-none transition-opacity duration-700"
        style={{
          transform: globeTransform,
          opacity: activeSection === 0 ? 0.86 : 0,
          transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)",
        }}
      >
        <div className="scale-75 sm:scale-90 lg:scale-100">
          <Globe />
        </div>
      </div>

      {sections.map((section, index) => (
        <section
          key={section.id}
          ref={(el) => (sectionRefs.current[index] = el)}
          className={cn(
            "relative z-20 flex min-h-screen flex-col justify-center px-4 py-16 sm:px-8 lg:px-16",
            section.align === "center" && "items-center text-center",
            section.align === "right" && "items-end text-right",
            section.align !== "center" && section.align !== "right" && "items-start text-left"
          )}
        >
          {index === 0 && (
            <>
              <TubesBackground
                className="absolute inset-0 min-h-0 h-full"
                enableClickInteraction={false}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[hsl(215,45%,10%,0.14)] via-transparent to-transparent" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_35%,hsl(24_95%_50%_/_0.12),transparent_52%)]" />
            </>
          )}

          <div
            className={cn(
              "w-full max-w-5xl",
              index === 0 && "px-1 sm:px-2"
            )}
          >
            {section.badge && (
              <p
                className={cn(
                  "mb-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]",
                  index === 0 ? "text-primary" : "text-primary"
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {section.badge}
              </p>
            )}

            {index === 0 && (
              <div className="mb-6 flex w-full justify-center">
                <span className="inline-flex items-center rounded-full border border-white/35 bg-[hsl(215,30%,8%,0.35)] px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white backdrop-blur-sm">
                  {heroSignals.join(" • ")}
                </span>
              </div>
            )}

            <h1
              className={cn(
                "font-display font-bold leading-[1.02] tracking-tight",
                index === 0 ? "text-4xl sm:text-6xl lg:text-7xl xl:text-8xl" : "text-3xl sm:text-5xl lg:text-6xl"
              )}
            >
              <span
                className={cn(
                  "bg-clip-text text-transparent",
                  index === 0
                    ? "bg-gradient-to-r from-white via-white to-white/85"
                    : "bg-gradient-to-r from-foreground via-foreground to-[hsl(195,55%,32%)]"
                )}
              >
                {section.title}
              </span>
              {section.subtitle && (
                <span
                  className={cn(
                    "mt-3 block text-[0.36em] font-semibold uppercase tracking-[0.22em]",
                    index === 0 ? "text-white/75" : "text-muted-foreground"
                  )}
                >
                  {section.subtitle}
                </span>
              )}
            </h1>

            {index === 0 && (
              <p className="mt-3 text-sm font-medium uppercase tracking-[0.2em] text-white/90 sm:text-base">
                Zyllo Tech Powered Solutions
              </p>
            )}

            <p
              className={cn(
                "mt-7 max-w-3xl text-base leading-relaxed sm:text-lg lg:text-xl",
                index === 0 ? "text-white/82" : "text-muted-foreground"
              )}
            >
              {section.description}
            </p>

            {section.features && (
              <div className="mt-8 space-y-5">
                {section.features.map((feature, featureIndex) => (
                  <div key={feature.title} className="relative pl-6">
                    <span className="absolute left-0 top-1.5 h-10 w-[2px] bg-gradient-to-b from-primary to-[hsl(195,55%,42%)]" />
                    <p className="text-sm font-semibold uppercase tracking-[0.1em] text-primary/85">
                      0{featureIndex + 1} {feature.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {section.actions && (
              <div
                className={cn(
                  "mt-10 flex flex-col gap-3 sm:flex-row",
                  section.align === "center" && "justify-center",
                  section.align === "right" && "justify-end"
                )}
              >
                {section.actions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.onClick}
                    className={cn(
                      "rounded-xl px-7 py-3.5 text-sm font-semibold transition-all sm:text-base",
                      action.variant === "primary"
                        ? "bg-gradient-orange text-primary-foreground shadow-[0_8px_28px_hsl(24_95%_50%_/_0.32)] hover:opacity-90"
                        : index === 0
                          ? "text-white hover:text-white/85"
                          : "text-foreground hover:text-primary"
                    )}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {index === 0 && (
              <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 text-center text-white/60">
                <p className="text-[10px] uppercase tracking-[0.24em] sm:text-xs">
                  Zyllo Tech AI Solutions
                </p>
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function GlobeScrollDemo() {
  const navigate = useNavigate();
  const demoSections = [
    {
      id: "hero",
      badge: "Zyllo Tech",
      title: "Zyllo Tech AI Power Solutions",
      subtitle: "The Future Is Here",
      description:
        "We design and build modern digital products with strong engineering discipline, practical AI usage, and clear business outcomes.",
      align: "left" as const,
      actions: [
        { label: "Contact Us", variant: "primary" as const, onClick: () => navigate("/contact") },
        { label: "Explore Services", variant: "secondary" as const, onClick: () => navigate("/services") },
      ],
    },
    {
      id: "about",
      badge: "About Us",
      title: "One Team for Product, Design, and Engineering",
      description:
        "From discovery to deployment, we work as one accountable team so your product quality and delivery velocity stay predictable.",
      align: "center" as const,
      actions: [{ label: "Learn About Us", variant: "secondary" as const, onClick: () => navigate("/about") }],
    },
    {
      id: "capabilities",
      badge: "Capabilities",
      title: "Services and Industry Expertise That Ship",
      subtitle: "From Idea to Production",
      description:
        "We deliver across web, mobile, cloud, AI, and automation for industries where reliability and speed both matter.",
      align: "left" as const,
      features: [
        { title: "Services", description: "Product engineering, AI solutions, cloud, design, and growth enablement." },
        { title: "Industries", description: "Domain-aware solutions for real workflows, compliance, and scale." },
        { title: "Resources", description: "Playbooks and practical insights your team can apply immediately." },
      ],
      actions: [
        { label: "View Industries", variant: "secondary" as const, onClick: () => navigate("/industries") },
        { label: "Open Resources", variant: "primary" as const, onClick: () => navigate("/resources") },
      ],
    },
    {
      id: "cta",
      badge: "Next Step",
      title: "Let’s Build Your Next Product",
      description:
        "Tell us your goals and constraints. We will propose a practical execution plan with timeline, milestones, and outcomes.",
      align: "center" as const,
      actions: [{ label: "Start Conversation", variant: "primary" as const, onClick: () => navigate("/contact") }],
    },
  ];

  return <ScrollGlobe sections={demoSections} className="bg-gradient-to-b from-background via-muted/15 to-background" />;
}
