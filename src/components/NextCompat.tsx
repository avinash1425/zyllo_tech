import { forwardRef } from "react";
import { Link, type LinkProps } from "react-router-dom";

type CompatLinkProps = Omit<LinkProps, "to"> & { href: string };
export const CompatLink = forwardRef<HTMLAnchorElement, CompatLinkProps>(function CompatLink(
  { href, children, ...props },
  ref,
) {
  return <Link ref={ref} to={href} {...props}>{children}</Link>;
});

type CompatImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  width?: number;
  height?: number;
};
export const CompatImage = forwardRef<HTMLImageElement, CompatImageProps>(function CompatImage(
  { fill, priority, style, ...props },
  ref,
) {
  return (
    <img
      ref={ref}
      {...props}
      loading={priority ? "eager" : props.loading}
      style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style}
    />
  );
});
