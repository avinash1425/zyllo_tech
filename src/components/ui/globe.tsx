import React, { useId } from "react";
import { cn } from "@/lib/utils";

type GlobeProps = {
  className?: string;
  size?: number;
  fullHeight?: boolean;
};

const Globe: React.FC<GlobeProps> = ({ className, size = 280, fullHeight = false }) => {
  const id = useId().replace(/:/g, "");

  return (
    <>
      <style>
        {`
          @keyframes spin-${id} {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }

          @keyframes drift-${id} {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
          }

          @keyframes shimmer-${id} {
            0%, 100% { opacity: 0.45; }
            50% { opacity: 0.9; }
          }

          @keyframes pulse-${id} {
            0%, 100% { transform: scale(1); opacity: 0.3; }
            50% { transform: scale(1.08); opacity: 0.55; }
          }
        `}
      </style>

      <div
        className={cn(
          "relative flex items-center justify-center",
          fullHeight ? "h-screen" : "h-full min-h-[260px]",
          className
        )}
      >
        <div
          className="absolute rounded-full bg-primary/15 blur-3xl"
          style={{ width: size * 1.2, height: size * 1.2, animation: `pulse-${id} 5.6s ease-in-out infinite` }}
        />

        <div
          className="relative rounded-full"
          style={{ width: size, height: size, animation: `drift-${id} 6s ease-in-out infinite` }}
        >
          <div
            className="absolute inset-0 rounded-full border border-primary/20"
            style={{
              background:
                "radial-gradient(circle at 30% 30%, hsl(195 75% 90%) 0%, hsl(195 62% 68%) 32%, hsl(215 55% 44%) 70%, hsl(215 52% 30%) 100%)",
              boxShadow:
                "inset -18px -14px 32px hsl(215 55% 20% / 0.38), inset 12px 12px 24px hsl(0 0% 100% / 0.24), 0 18px 40px hsl(24 95% 50% / 0.22)",
            }}
          />

          <div
            className="absolute inset-0 rounded-full opacity-70"
            style={{
              background:
                "repeating-linear-gradient(0deg, hsl(0 0% 100% / 0.24) 0px, hsl(0 0% 100% / 0.24) 1px, transparent 1px, transparent 14px), repeating-linear-gradient(90deg, hsl(0 0% 100% / 0.22) 0px, hsl(0 0% 100% / 0.22) 1px, transparent 1px, transparent 16px)",
              animation: `spin-${id} 28s linear infinite`,
              mixBlendMode: "soft-light",
            }}
          />

          <div
            className="absolute left-[16%] top-[22%] h-[22%] w-[28%] rounded-[45%]"
            style={{
              background: "hsl(150 45% 56% / 0.75)",
              filter: "blur(0.6px)",
              animation: `shimmer-${id} 4.2s ease-in-out infinite`,
            }}
          />
          <div
            className="absolute right-[18%] top-[44%] h-[16%] w-[24%] rounded-[48%]"
            style={{
              background: "hsl(148 40% 52% / 0.72)",
              filter: "blur(0.6px)",
              animation: `shimmer-${id} 4.8s ease-in-out infinite`,
            }}
          />
          <div
            className="absolute left-[38%] bottom-[18%] h-[15%] w-[18%] rounded-[44%]"
            style={{
              background: "hsl(150 38% 54% / 0.7)",
              filter: "blur(0.6px)",
              animation: `shimmer-${id} 5.2s ease-in-out infinite`,
            }}
          />

          <div
            className="absolute -inset-[11%] rounded-full border border-primary/20"
            style={{ animation: `spin-${id} 18s linear infinite` }}
          >
            <span className="absolute left-1/2 top-[-5px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_12px_hsl(24_95%_50%_/_0.6)]" />
          </div>
          <div
            className="absolute -inset-[18%] rounded-full border border-[hsl(195_55%_42%_/_0.3)]"
            style={{ animation: `spin-${id} 24s linear infinite reverse` }}
          >
            <span className="absolute right-[8%] top-[44%] h-2 w-2 rounded-full bg-[hsl(195,55%,42%)] shadow-[0_0_10px_hsl(195_55%_42%_/_0.5)]" />
          </div>

          <div className="absolute left-[18%] top-[14%] h-3 w-3 rounded-full bg-white/40 blur-[1px]" />
          <div className="absolute left-[30%] top-[22%] h-2 w-2 rounded-full bg-white/45 blur-[1px]" />
        </div>
      </div>
    </>
  );
};

export default Globe;
