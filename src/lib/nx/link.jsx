// Drop-in for next/link on top of react-router.
import { forwardRef } from "react";
import { Link as RouterLink } from "react-router-dom";

const Link = forwardRef(function Link({ href, prefetch, scroll, replace, ...rest }, ref) {
  const to = typeof href === "object" && href !== null
    ? `${href.pathname || ""}${href.search || ""}${href.hash || ""}`
    : href;
  if (typeof to === "string" && /^(https?:|mailto:|tel:|#)/.test(to)) {
    return <a ref={ref} href={to} {...rest} />;
  }
  return <RouterLink ref={ref} to={to} replace={replace} {...rest} />;
});

export default Link;
