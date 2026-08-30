import { forwardRef } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams as useRouterSearchParams,
  type LinkProps,
} from "react-router-dom";

const isExternal = (href: string) =>
  /^(https?:|mailto:|tel:|#|\/\/)/.test(href) || href.endsWith(".html");

type CompatLinkProps = Omit<LinkProps, "to"> & { href: string };
export const CompatLink = forwardRef<HTMLAnchorElement, CompatLinkProps>(function CompatLink(
  { href, children, ...props },
  ref,
) {
  // External links, mail/tel, in-page anchors and static HTML files must stay
  // plain anchors — the router would otherwise treat them as app routes.
  if (isExternal(href)) {
    return (
      <a ref={ref} href={href} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }
  return (
    <Link ref={ref} to={href} {...props}>
      {children}
    </Link>
  );
});

type CompatImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  quality?: number;
  unoptimized?: boolean;
};
export const CompatImage = forwardRef<HTMLImageElement, CompatImageProps>(function CompatImage(
  { fill, priority, quality, unoptimized, style, fetchPriority, ...props },
  ref,
) {
  return (
    <img
      ref={ref}
      {...props}
      // Every image on the site renders through this shim, so the default set
      // here is the site-wide default. Anything not explicitly marked
      // `priority` (hero slide 1, the logo, page heroes) is below the fold or
      // offscreen in a carousel, so it should not compete with the LCP element
      // for bandwidth. An explicit `loading` prop still wins.
      loading={priority ? "eager" : props.loading ?? "lazy"}
      decoding={props.decoding ?? "async"}
      // React 18 does not map the camelCase `fetchPriority` prop, so pass the
      // real lowercase HTML attribute instead of triggering a DOM warning.
      {...({ fetchpriority: fetchPriority ?? (priority ? "high" : undefined) } as Record<string, string | undefined>)}

      style={
        fill
          ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style }
          : style
      }
    />
  );
});

// next/navigation shims used by the ported components.
export const usePathname = () => useLocation().pathname;

export const useRouter = () => {
  const navigate = useNavigate();
  return {
    push: (url: string) => navigate(url),
    replace: (url: string) => navigate(url, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => {},
    prefetch: () => {},
  };
};

export const useSearchParams = () => useRouterSearchParams()[0];
