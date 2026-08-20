import { Sparkles, Cloud, Smartphone, Database } from "lucide-react";

// Code-built globe/network illustration — no photo, no AI-generated image.
// A rotating wireframe globe (SVG arcs) with 4 orbiting tech icon chips
// connected by glowing lines, on a light card background. Stands in for a
// "holographic globe" visual using real markup instead of a generated image.
const ORBIT_ICONS = [
  { Icon: Sparkles, accent: "#3b82f6", top: "8%", left: "6%" },
  { Icon: Cloud, accent: "#10b981", top: "10%", left: "78%" },
  { Icon: Smartphone, accent: "#8b5cf6", top: "72%", left: "4%" },
  { Icon: Database, accent: "#ec4899", top: "74%", left: "80%" },
];

export default function TechGlobe() {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[#e7e9ee] bg-gradient-to-br from-[#f5f7fb] via-white to-[#f5f7fb] shadow-xl">
      {/* Ambient glow */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#3b82f6]/10 blur-[70px]" />
      </div>

      {/* Globe */}
      <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 sm:h-56 sm:w-56">
        <svg
          viewBox="0 0 200 200"
          className="globe-spin h-full w-full"
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="90" fill="none" stroke="#3b82f6" strokeOpacity="0.15" strokeWidth="1.5" />
          {/* Latitude ellipses */}
          <ellipse cx="100" cy="100" rx="90" ry="30" fill="none" stroke="#3b82f6" strokeOpacity="0.35" strokeWidth="1.2" />
          <ellipse cx="100" cy="100" rx="90" ry="55" fill="none" stroke="#8b5cf6" strokeOpacity="0.3" strokeWidth="1.2" />
          <ellipse cx="100" cy="100" rx="90" ry="75" fill="none" stroke="#10b981" strokeOpacity="0.25" strokeWidth="1.2" />
          {/* Longitude arcs */}
          <ellipse cx="100" cy="100" rx="30" ry="90" fill="none" stroke="#3b82f6" strokeOpacity="0.3" strokeWidth="1.2" />
          <ellipse cx="100" cy="100" rx="55" ry="90" fill="none" stroke="#8b5cf6" strokeOpacity="0.25" strokeWidth="1.2" />
          {/* Dot grid scattered on the sphere */}
          {Array.from({ length: 40 }).map((_, i) => {
            const angle = (i / 40) * Math.PI * 2 * 3;
            const radius = 90 * Math.sin((i / 40) * Math.PI);
            const x = 100 + radius * Math.cos(angle);
            const y = 20 + (i / 40) * 160;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r="1.3"
                fill={i % 3 === 0 ? "#3b82f6" : i % 3 === 1 ? "#8b5cf6" : "#10b981"}
                opacity="0.5"
              />
            );
          })}
        </svg>
        {/* Sweeping highlight arc, like the orange sweep in the reference */}
        <div
          aria-hidden="true"
          className="globe-sweep absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0%, #f59e0b55 8%, transparent 16%)",
          }}
        />
      </div>

      {/* Connector lines from globe to orbiting chips */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        {ORBIT_ICONS.map(({ accent, top, left }, i) => (
          <line
            key={i}
            x1="50%"
            y1="50%"
            x2={left}
            y2={top}
            stroke={accent}
            strokeOpacity="0.25"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        ))}
      </svg>

      {/* Orbiting icon chips */}
      {ORBIT_ICONS.map(({ Icon, accent, top, left }, i) => (
        <span
          key={i}
          className="orbit-chip absolute flex h-11 w-11 items-center justify-center rounded-2xl border bg-white shadow-lg"
          style={{
            top,
            left,
            borderColor: `${accent}30`,
            animationDelay: `${i * 0.6}s`,
          }}
        >
          <Icon className="h-5 w-5" style={{ color: accent }} aria-hidden="true" />
        </span>
      ))}

      <style>{`
        .globe-spin {
          animation: globeSpin 24s linear infinite;
        }
        @keyframes globeSpin {
          from {
            transform: rotateY(0deg);
          }
          to {
            transform: rotateY(360deg);
          }
        }
        .globe-sweep {
          animation: sweepRotate 6s linear infinite;
        }
        @keyframes sweepRotate {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .orbit-chip {
          animation: chipFloat 5s ease-in-out infinite;
        }
        @keyframes chipFloat {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
      `}</style>
    </div>
  );
}
