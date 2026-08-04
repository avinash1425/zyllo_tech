"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wraps a section and animates it into view as it enters the viewport —
 * scrolling down: rises up from below, scaling/fading in.
 * scrolling up: drops down from above, scaling/fading in.
 * Re-triggers every time the section crosses in or out of view, in either direction.
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
        } else {
          // Leaving the viewport — decide which side it exited from so the
          // next entrance animates from the matching direction.
          const rect = entry.boundingClientRect;
          const exitedAbove = rect.top < 0;
          setState(exitedAbove ? "hidden-up" : "hidden-down");
        }
      },
      { threshold: 0.03, rootMargin: "0px 0px -5% 0px" }
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

      <style jsx>{`
        .reveal-wrap {
          transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1),
            transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
          will-change: opacity, transform;
        }
        .reveal-hidden-down {
          opacity: 0;
          transform: scale(0.88) translateY(72px);
        }
        .reveal-hidden-up {
          opacity: 0;
          transform: scale(0.88) translateY(-72px);
        }
        .reveal-visible {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      `}</style>
    </div>
  );
}
