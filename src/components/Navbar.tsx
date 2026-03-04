import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Search, ArrowRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import logo from "@/assets/zyllo-logo.png";
import TopBar from "./TopBar";
import SearchDialog from "./SearchDialog";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Services", href: "/services" },
  { label: "Industries", href: "/industries" },
  { label: "Resources", href: "/resources" },
  { label: "Contact", href: "/contact" },
];

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("open-ai-search", openSearch);
    return () => window.removeEventListener("open-ai-search", openSearch);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed left-0 right-0 top-0 z-50"
    >
      <TopBar />

      <nav
        className={`border-b border-border/80 bg-background/92 backdrop-blur-xl transition-shadow ${
          isScrolled ? "shadow-[0_10px_26px_hsl(215_24%_14%_/_0.08)]" : ""
        }`}
      >
        <div className="container mx-auto flex items-center justify-between px-4 py-2.5 sm:px-6">
          <Link to="/" className="flex items-center">
            <img src={logo} alt="Zyllo Tech" className="h-10 w-auto object-contain md:h-11" />
          </Link>

          <div className="hidden items-center gap-3 lg:flex">
            <div className="flex items-center gap-1 rounded-full border border-border bg-background/70 px-1.5 py-1">
              {navLinks.map((link) => {
                const isActive = location.pathname === link.href;
                return (
                  <Link
                    key={link.label}
                    to={link.href}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary/12 text-primary"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>

            <button
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/65 transition-colors hover:border-primary/40 hover:text-primary"
              aria-label="Open search"
            >
              <Search size={17} />
            </button>

            <Link
              to="/contact"
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Let&apos;s Talk <ArrowRight size={14} />
            </Link>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/70"
              aria-label="Open search"
            >
              <Search size={17} />
            </button>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="border-t border-border bg-background/98 px-4 py-4 sm:px-6 lg:hidden"
            >
              <div className="space-y-1.5">
                {navLinks.map((link) => {
                  const isActive = location.pathname === link.href;
                  return (
                    <Link
                      key={link.label}
                      to={link.href}
                      className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>

              <Link
                to="/contact"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                Let&apos;s Talk <ArrowRight size={14} />
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </motion.header>
  );
};

export default Navbar;
