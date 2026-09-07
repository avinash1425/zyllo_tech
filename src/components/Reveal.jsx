import { useEffect, useRef, useState } from "react";

/**
 * Wraps a section and animates it into view the first time it enters the
 * viewport — scrolling down: rises up from below, scaling/fading in.
 * scrolling up: drops down from above, scaling/fading in.
 * Reveals once and stays visible after that, so scrolling back up to
 * re-read a section doesn't re-hide it.
 */
export default function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [state, setState] = useState("hidden-down"); // hidden-down | hidden-up | visible

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let lastY = window.scrollY;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const scrollingDown = window.scrollY > lastY;
        lastY = window.scrollY;

        if (entry.isIntersecting) {
          setState("visible");
          observer.disconnect();
        } else {
          // Hasn't been revealed yet — decide which side it's approaching
          // from so the entrance animates from the matching direction.
          const rect = entry.boundingClientRect;
          const exitedAbove = rect.top < 0;
          setState(exitedAbove ? "hidden-up" : "hidden-down");
        }
      },
      // Trigger as soon as any part of the section approaches the viewport —
      // a late trigger plus a slow transition reads as blank white sections
      // to anyone scrolling at normal speed.
      { threshold: 0.01, rootMargin: "0px 0px 5% 0px" }
    );

    const handleScroll = () => {
      lastY = window.scrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    observer.observe(node);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal-wrap reveal-${state} ${className}`}
      style={{ transitionDelay: state === "visible" ? `${delay}ms` : "0ms" }}
    >
      {children}

      <style>{`
        .reveal-wrap {
          overflow: clip;
          /* Short and blur-free: the old 1s blurred reveal left sections
             invisible for over a second of normal-speed scrolling. */
          transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1),
            transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          will-change: opacity, transform;
        }
        .reveal-hidden-down {
          opacity: 0;
          transform: translateY(24px);
        }
        .reveal-hidden-up {
          opacity: 0;
          transform: translateY(-24px);
        }
        .reveal-visible {
          opacity: 1;
          transform: translateY(0);
        }
        @media (prefers-reduced-motion: reduce) {
          .reveal-wrap {
            transition: none;
          }
          .reveal-hidden-down,
          .reveal-hidden-up {
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
