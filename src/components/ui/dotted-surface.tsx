"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Dot = {
  x: number;
  y: number;
  baseY: number;
  phaseX: number;
  phaseY: number;
};

type DottedSurfaceProps = Omit<React.ComponentProps<"div">, "ref">;

export function DottedSurface({ className, ...props }: DottedSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.className = "h-full w-full";
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dots: Dot[] = [];
    let time = 0;
    let width = 0;
    let height = 0;
    const spacingX = 36;
    const spacingY = 30;

    const setupDots = () => {
      width = container.clientWidth;
      height = container.clientHeight;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots.length = 0;
      const cols = Math.ceil(width / spacingX) + 2;
      const rows = Math.ceil(height / spacingY) + 2;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * spacingX - spacingX / 2;
          const y = row * spacingY - spacingY / 2;
          dots.push({
            x,
            y,
            baseY: y,
            phaseX: col * 0.18,
            phaseY: row * 0.22,
          });
        }
      }
    };

    const draw = () => {
      const dark = document.documentElement.classList.contains("dark");
      const dotColor = dark ? "rgba(245, 245, 245, 0.48)" : "rgba(24, 36, 56, 0.26)";

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = dotColor;

      for (const dot of dots) {
        const wave = Math.sin(time * 0.9 + dot.phaseX) * 5 + Math.cos(time * 1.2 + dot.phaseY) * 4;
        const y = dot.baseY + wave;
        ctx.beginPath();
        ctx.arc(dot.x, y, 1.35, 0, Math.PI * 2);
        ctx.fill();
      }

      time += 0.014;
      frameRef.current = requestAnimationFrame(draw);
    };

    setupDots();
    draw();

    const resizeObserver = new ResizeObserver(() => {
      setupDots();
    });
    resizeObserver.observe(container);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      if (canvasRef.current && container.contains(canvasRef.current)) {
        container.removeChild(canvasRef.current);
      }
    };
  }, []);

  return <div ref={containerRef} className={cn("pointer-events-none absolute inset-0", className)} {...props} />;
}

