import AdminShell from "./AdminShell";

// Server component wrapper — exists solely so this segment can export
// noindex metadata. The actual sidebar/header/nav logic lives in
// AdminShell.js ("use client"), since a client component cannot export
// `metadata` (Next.js requirement).
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}
