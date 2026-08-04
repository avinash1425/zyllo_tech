import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import SiteChrome from "@/components/SiteChrome";

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const headingFont = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata = {
  title: "Zyllo Tech",
  description: "Zyllo Tech — building premium software solutions for ambitious companies.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${headingFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
