// Drop-ins for next/navigation hooks on top of react-router.
import { useLocation, useNavigate, useParams as useRouterParams, useSearchParams as useRouterSearchParams, Navigate } from "react-router-dom";
import { useMemo } from "react";

export function usePathname() {
  return useLocation().pathname;
}

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (to) => navigate(to),
      replace: (to) => navigate(to, { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      refresh: () => window.dispatchEvent(new Event("nx:refresh")),
      prefetch: () => {},
    }),
    [navigate]
  );
}

export function useSearchParams() {
  const [params] = useRouterSearchParams();
  return params;
}

export const useParams = useRouterParams;

// Declarative redirect: render <Redirect to="/x" /> instead of calling redirect().
export function Redirect({ to }) {
  return <Navigate to={to} replace />;
}
