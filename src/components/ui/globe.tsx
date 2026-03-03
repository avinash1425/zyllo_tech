import React, { useId } from "react";
import { cn } from "@/lib/utils";

type GlobeProps = {
  className?: string;
  size?: number;
  fullHeight?: boolean;
};

const Globe: React.FC<GlobeProps> = ({ className, size = 220, fullHeight = false }) => {
  const id = useId().replace(/:/g, "");

  return (
    <>
      <style>
        {`
          @keyframes earthRotate-${id} {
            0% { background-position: 0 0; }
            100% { background-position: 400px 0; }
          }
          @keyframes twinkling-${id} { 0%,100% { opacity:0.15; } 50% { opacity:1; } }
          @keyframes twinklingSlow-${id} { 0%,100% { opacity:0.2; } 50% { opacity:0.9; } }
          @keyframes twinklingLong-${id} { 0%,100% { opacity:0.1; } 50% { opacity:1; } }
          @keyframes twinklingFast-${id} { 0%,100% { opacity:0.2; } 50% { opacity:1; } }
        `}
      </style>

      <div
        className={cn(
          "flex items-center justify-center",
          fullHeight ? "h-screen" : "h-full min-h-[240px]",
          className
        )}
      >
        <div
          className="relative rounded-full overflow-hidden shadow-[0_0_20px_rgba(255,255,255,0.18),-5px_0_8px_#c3f4ff_inset,15px_2px_25px_#000_inset,-24px_-2px_34px_#c3f4ff99_inset,250px_0_44px_#00000066_inset,150px_0_38px_#000000aa_inset]"
          style={{
            width: size,
            height: size,
            backgroundImage:
              "url('https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?auto=format&fit=crop&w=900&q=80')",
            backgroundSize: "cover",
            backgroundPosition: "left",
            animation: `earthRotate-${id} 30s linear infinite`,
          }}
        >
          <div
            className="absolute left-[-20px] w-1 h-1 bg-white rounded-full"
            style={{ animation: `twinkling-${id} 3s infinite` }}
          />
          <div
            className="absolute left-[-40px] top-[30px] w-1 h-1 bg-white rounded-full"
            style={{ animation: `twinklingSlow-${id} 2s infinite` }}
          />
          <div
            className="absolute left-[350px] top-[90px] w-1 h-1 bg-white rounded-full"
            style={{ animation: `twinklingLong-${id} 4s infinite` }}
          />
          <div
            className="absolute left-[200px] top-[290px] w-1 h-1 bg-white rounded-full"
            style={{ animation: `twinkling-${id} 3s infinite` }}
          />
          <div
            className="absolute left-[50px] top-[270px] w-1 h-1 bg-white rounded-full"
            style={{ animation: `twinklingFast-${id} 1.5s infinite` }}
          />
          <div
            className="absolute left-[250px] top-[-50px] w-1 h-1 bg-white rounded-full"
            style={{ animation: `twinklingLong-${id} 4s infinite` }}
          />
          <div
            className="absolute left-[290px] top-[60px] w-1 h-1 bg-white rounded-full"
            style={{ animation: `twinklingSlow-${id} 2s infinite` }}
          />
        </div>
      </div>
    </>
  );
};

export default Globe;
