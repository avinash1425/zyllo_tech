import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Search, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import logo from "@/assets/zyllo-logo.png";
import TopBar from "./TopBar";
import SearchDialog from "./SearchDialog";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "About Us", href: "/about" },
  { label: "Services", href: "/services" },
  { label: "Industries", href: "/industries" },
  { label: "Resources", href: "/resources" },
  { label: "Contact Us", href: "/contact" },
];

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("open-ai-search", openSearch);
    return () => window.removeEventListener("open-ai-search", openSearch);
  }, []);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <TopBar />
      <nav className="bg-background/95 backdrop-blur-md border-b border-border">
      <div className="container mx-auto flex items-center justify-between px-4 sm:px-6 py-1.5">
        <Link to="/" className="flex items-center">
          <img src={logo} alt="Zyllo Tech" className="h-10 md:h-11 w-auto object-contain" />
        </Link>

        <div className="hidden lg:flex items-center gap-4">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              to={link.href}
              className={`rounded-md px-2 py-1 text-[14px] font-semibold transition-colors duration-200 ${
                location.pathname === link.href
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/70 hover:bg-muted/60 hover:text-primary"
              }`}
                >
              {link.label}
            </Link>
          ))}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-gradient-to-r from-primary/15 to-[hsl(195,55%,42%,0.2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            <Sparkles size={12} />
            AI-Powered
          </span>
          <button
            onClick={() => setSearchOpen(true)}
            className="text-foreground/60 hover:text-primary transition-colors"
            aria-label="Search"
          >
            <Search size={20} />
          </button>
        </div>

        <button
          className="lg:hidden text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="lg:hidden overflow-hidden border-t border-border bg-background"
          >
            <div className="flex flex-col gap-3 px-6 py-4">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`text-base transition-colors ${
                    location.pathname === link.href
                      ? "text-primary font-medium"
                      : "text-foreground/70 hover:text-primary"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </nav>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </motion.header>
  );
};

export default Navbar;
