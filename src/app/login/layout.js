// Server component sibling to page.js ("use client") — exists solely to
// export noindex metadata, since a client component cannot export
// `metadata` directly.
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginLayout({ children }) {
  return children;
}
