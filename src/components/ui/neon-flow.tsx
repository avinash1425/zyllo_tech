import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface TubesBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
}

export function TubesBackground({ children, className }: TubesBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    const drawInfinity = (t: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.22;

      ctx.clearRect(0, 0, w, h);

      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h));
      bg.addColorStop(0, "rgba(26, 32, 44, 0.06)");
      bg.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.12);

      const path = new Path2D();
      let started = false;
      for (let i = 0; i <= 720; i++) {
        const a = (i / 720) * Math.PI * 2;
        const x = (Math.sin(a) * scale * 2) / (1 + Math.cos(a) ** 2);
        const y = (Math.sin(a) * Math.cos(a) * scale * 1.25) / (1 + Math.cos(a) ** 2);
        if (!started) {
          path.moveTo(x, y);
          started = true;
        } else {
          path.lineTo(x, y);
        }
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.shadowBlur = 26;
      ctx.shadowColor = "rgba(249, 115, 22, 0.4)";
      ctx.strokeStyle = "rgba(249, 115, 22, 0.45)";
      ctx.lineWidth = 16;
      ctx.stroke(path);

      const grad = ctx.createLinearGradient(-scale * 2, 0, scale * 2, 0);
      grad.addColorStop(0, "#f97316");
      grad.addColorStop(0.5, "#06b6d4");
      grad.addColorStop(1, "#f97316");
      ctx.shadowBlur = 14;
      ctx.shadowColor = "rgba(6, 182, 212, 0.3)";
      ctx.strokeStyle = grad;
      ctx.lineWidth = 9;
      ctx.stroke(path);

      ctx.setLineDash([26, 16]);
      ctx.lineDashOffset = -(t * 120);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.72)";
      ctx.lineWidth = 2.5;
      ctx.stroke(path);
      ctx.setLineDash([]);

      ctx.restore();
    };

    const loop = () => {
      frame += 1;
      drawInfinity(frame / 60);
      raf = requestAnimationFrame(loop);
    };

    resize();
    loop();
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className={cn("relative w-full h-full min-h-[400px] overflow-hidden bg-transparent", className)}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full block" style={{ touchAction: "none" }} />
      <div className="relative z-10 h-full w-full pointer-events-none">{children}</div>
    </div>
  );
}

export default TubesBackground;
