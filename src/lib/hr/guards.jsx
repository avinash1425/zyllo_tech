// Route guards for HR Operations / Employee Portal. UX only: the server
// (RLS + SECURITY DEFINER RPCs) enforces every rule independently.
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import Link from "@/hr/platform/link";
import { Loading } from "@/hr/ui";

function Blocked({ title, message }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb] px-4">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-[#f96706]" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-extrabold text-[#101a3a]">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-[#173a52] hover:bg-slate-50">Public website</Link>
          <Link href="/hr/login" className="rounded-xl bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 py-2 text-sm font-semibold text-white">Sign in</Link>
        </div>
      </div>
    </div>
  );
}

function useGate() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return { el: <div className="min-h-screen bg-[#f6f7fb]"><Loading label="Checking your access…" /></div> };
  if (!auth.user) return { el: <Navigate to={`/hr/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace /> };
  if (auth.hr?.revoked) return { el: <Blocked title="Access disabled" message="Your portal access has been disabled. Contact HR if you believe this is a mistake." /> };
  return { auth };
}

// HR paths that have an Employee Portal equivalent for employees without HR
// permissions (e.g. notification links sent to interview panel members).
const EMPLOYEE_EQUIVALENTS = [
  [/^\/hr\/recruitment\/interviews/, "/employee/interviews"],
];

/** Requires at least one of `anyOf` permissions (HR Operations area). */
export function RequireHrAccess({ anyOf, children }) {
  const { el, auth } = useGate();
  const location = useLocation();
  if (el) return el;
  if (!anyOf.some((p) => auth.hasPermission(p))) {
    const target = auth.hr?.employee && EMPLOYEE_EQUIVALENTS.find(([re]) => re.test(location.pathname))?.[1];
    if (target) return <Navigate to={target} replace />;
    return <Blocked title="Not authorised" message="Your account does not have access to HR Operations." />;
  }
  return children;
}

/** Requires an active, linked employee record (Employee Portal). */
export function RequireEmployee({ children }) {
  const { el, auth } = useGate();
  if (el) return el;
  if (!auth.hr?.employee) {
    return <Blocked title="No employee profile" message="This account is not linked to an active employee record. Use the invitation link from HR, or contact HR." />;
  }
  return children;
}

/** Inline permission gate for a page section. */
export function Can({ permission, anyOf, children, fallback = null }) {
  const { hasPermission } = useAuth();
  const list = anyOf ?? (permission ? [permission] : []);
  return list.some((p) => hasPermission(p)) ? children : fallback;
}
