import Header from "@/components/Header";

// Legacy pages (admin, dashboard, auth, tool pages) still import Navbar.
// The new site header is Header.jsx; this keeps a single implementation.
export default function Navbar() {
  return <Header />;
}
