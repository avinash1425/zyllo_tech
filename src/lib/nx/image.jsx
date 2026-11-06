import { getOptimizedImage } from "@/lib/optimized-images";

// Drop-in for next/image: plain <img> with lazy loading. Supports the
// props this codebase uses (src, alt, width, height, fill, priority, sizes).
// Local images with generated WebP variants are swapped in automatically;
// anything else (Supabase uploads, blog images) is rendered as given.
export default function Image({
  src, alt = "", width, height, fill, priority, sizes,
  quality, placeholder, blurDataURL, unoptimized, loader, style, className, ...rest
}) {
  const url = typeof src === "object" && src ? src.src : src;
  const optimized = getOptimizedImage(url);
  const fillStyle = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
    : null;
  return (
    <img
      src={optimized?.src ?? url}
      srcSet={optimized?.srcSet}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes ?? optimized?.sizes}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding={priority ? "sync" : "async"}
      className={className}
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
}
