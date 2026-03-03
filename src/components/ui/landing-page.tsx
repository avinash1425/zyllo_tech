import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Globe from "@/components/ui/globe";
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
  positions: [
    { top: "50%", left: "77%", scale: 1.25 },
    { top: "32%", left: "56%", scale: 0.92 },
    { top: "24%", left: "86%", scale: 1.25 },
    { top: "50%", left: "50%", scale: 1.5 },
  ],
};

const parsePercent = (str: string): number => parseFloat(str.replace("%", ""));

function ScrollGlobe({ sections, globeConfig = defaultGlobeConfig, className }: ScrollGlobeProps) {
  const [activeSection, setActiveSection] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [globeTransform, setGlobeTransform] = useState("");
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const animationFrameId = useRef<number>();

  const calculatedPositions = useMemo(() => {
    return globeConfig.positions.map((pos) => ({
      top: parsePercent(pos.top),
      left: parsePercent(pos.left),
      scale: pos.scale,
    }));
  }, [globeConfig.positions]);

  const updateScrollPosition = useCallback(() => {
    const scrollTop = window.pageYOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = Math.min(Math.max(scrollTop / docHeight, 0), 1);
    setScrollProgress(progress);

    const viewportCenter = window.innerHeight / 2;
    let newActiveSection = 0;
    let minDistance = Number.POSITIVE_INFINITY;

    sectionRefs.current.forEach((ref, index) => {
      if (!ref) return;
      const rect = ref.getBoundingClientRect();
      const sectionCenter = rect.top + rect.height / 2;
      const distance = Math.abs(sectionCenter - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        newActiveSection = index;
      }
    });

    const currentPos = calculatedPositions[newActiveSection] ?? calculatedPositions[0];
    setGlobeTransform(
      `translate3d(${currentPos.left}vw, ${currentPos.top}vh, 0) translate3d(-50%, -50%, 0) scale3d(${currentPos.scale}, ${currentPos.scale}, 1)`
    );
    setActiveSection(newActiveSection);
  }, [calculatedPositions]);

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
    const initialPos = calculatedPositions[0];
    if (!initialPos) return;
    setGlobeTransform(
      `translate3d(${initialPos.left}vw, ${initialPos.top}vh, 0) translate3d(-50%, -50%, 0) scale3d(${initialPos.scale}, ${initialPos.scale}, 1)`
    );
  }, [calculatedPositions]);

  return (
    <div
      className={cn(
        "relative min-h-screen w-full max-w-screen overflow-x-hidden bg-gradient-to-b from-background via-[hsl(24,95%,98%)] to-background text-foreground",
        className
      )}
    >
      <div className="fixed left-0 top-0 z-40 h-0.5 w-full bg-gradient-to-r from-primary/20 via-primary/10 to-[hsl(195,55%,42%,0.2)]">
        <div
          className="h-full bg-gradient-to-r from-primary via-[hsl(24,90%,58%)] to-[hsl(195,55%,42%)]"
          style={{
            transform: `scaleX(${scrollProgress})`,
            transformOrigin: "left center",
            transition: "transform 120ms ease-out",
          }}
        />
      </div>

      <div className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 sm:flex lg:right-6">
        <div className="space-y-4">
          {sections.map((section, index) => (
            <div key={section.id} className="relative group">
              <div
                className={cn(
                  "absolute right-7 top-1/2 -translate-y-1/2 rounded-md border border-border/60 bg-background/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur-md",
                  activeSection === index ? "animate-fadeOut text-foreground" : "opacity-0"
                )}
              >
                {section.badge || `Section ${index + 1}`}
              </div>
              <button
                onClick={() => sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className={cn(
                  "h-2.5 w-2.5 rounded-full border-2 transition-all duration-300 hover:scale-125",
                  activeSection === index
                    ? "border-primary bg-primary shadow-[0_0_14px_hsl(24_95%_50%_/_0.45)]"
                    : "border-muted-foreground/40 bg-transparent hover:border-primary/60 hover:bg-primary/10"
                )}
                aria-label={`Go to ${section.badge || `section ${index + 1}`}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div
        className="pointer-events-none fixed z-10 hidden transition-all md:block"
        style={{
          transform: globeTransform,
          filter: `opacity(${activeSection === 3 ? 0.35 : 0.82})`,
          transitionDuration: "1100ms",
          transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)",
        }}
      >
        <Globe className="min-h-0" size={240} />
      </div>

      {sections.map((section, index) => (
        <section
          key={section.id}
          ref={(el) => (sectionRefs.current[index] = el)}
          className={cn(
            "relative z-20 flex min-h-screen w-full max-w-full flex-col justify-center overflow-hidden px-4 py-16 sm:px-6 lg:px-12",
            section.align === "center" && "items-center text-center",
            section.align === "right" && "items-end text-right",
            section.align !== "center" && section.align !== "right" && "items-start text-left"
          )}
        >
          <div className="w-full max-w-sm sm:max-w-xl lg:max-w-3xl">
            {section.badge && (
              <p className="mb-4 inline-flex rounded-full border border-primary/35 bg-gradient-to-r from-primary/10 to-[hsl(195,55%,42%,0.12)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                {section.badge}
              </p>
            )}

            <h1
              className={cn(
                "mb-6 font-display font-bold leading-[1.06] tracking-tight text-foreground",
                index === 0 ? "text-4xl sm:text-5xl lg:text-6xl" : "text-3xl sm:text-4xl lg:text-5xl"
              )}
            >
              <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/80 bg-clip-text text-transparent">
                {section.title}
              </span>
              {section.subtitle && (
                <span className="mt-1 block text-[0.58em] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {section.subtitle}
                </span>
              )}
            </h1>

            <p className="mb-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {section.description}
            </p>

            {section.features && (
              <div className="mb-8 grid gap-3">
                {section.features.map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-xl border border-border/80 bg-card/75 p-4 backdrop-blur-sm transition-all hover:border-primary/30"
                  >
                    <h3 className="font-semibold text-card-foreground">{feature.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                ))}
              </div>
            )}

            {section.actions && (
              <div
                className={cn(
                  "flex flex-col gap-3 sm:flex-row",
                  section.align === "center" && "justify-center",
                  section.align === "right" && "justify-end"
                )}
              >
                {section.actions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.onClick}
                    className={cn(
                      "rounded-xl px-6 py-3 text-sm font-semibold transition-all sm:text-base",
                      action.variant === "primary"
                        ? "bg-gradient-orange text-primary-foreground hover:opacity-90"
                        : "border border-border bg-background/70 text-foreground hover:border-primary/30"
                    )}
                  >
                    {action.label}
                  </button>
                ))}
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

  const sections = [
    {
      id: "hero",
      badge: "Zyllo Tech",
      title: "Build Faster. Scale Smarter.",
      subtitle: "AI-Powered Software Delivery",
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

  return <ScrollGlobe sections={sections} className="bg-gradient-to-b from-background via-muted/20 to-background" />;
}
