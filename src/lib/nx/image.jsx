// Drop-in for next/image: plain <img> with lazy loading. Supports the
// props this codebase uses (src, alt, width, height, fill, priority, sizes).
export default function Image({
  src, alt = "", width, height, fill, priority, sizes,
  quality, placeholder, blurDataURL, unoptimized, loader, style, className, ...rest
}) {
  const url = typeof src === "object" && src ? src.src : src;
  const fillStyle = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
    : null;
  return (
    <img
      src={url}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={className}
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
}
