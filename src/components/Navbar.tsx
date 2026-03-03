import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Search } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import logo from "@/assets/zyllo-logo.png";
import TopBar from "./TopBar";
import SearchDialog from "./SearchDialog";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "Industries", href: "/industries" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Blog", href: "/blog" },
  { label: "About", href: "/about" },
  { label: "Careers", href: "/careers" },
  { label: "Contact", href: "/contact" },
];

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <TopBar />
      <nav className="bg-background/95 backdrop-blur-md border-b border-border">
      <div className="container mx-auto flex items-center justify-between px-4 sm:px-6 py-1">
        <Link to="/" className="flex items-center">
          <img src={logo} alt="Zyllo Tech" className="h-24 w-auto object-contain" />
        </Link>

        <div className="hidden lg:flex items-center gap-7">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              to={link.href}
              className={`relative text-sm font-medium transition-colors duration-200 pb-1 ${
                location.pathname === link.href
                  ? "text-primary after:absolute after:bottom-[-14px] after:left-0 after:right-0 after:h-[2px] after:bg-primary"
                  : "text-foreground/70 hover:text-primary"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <button
            onClick={() => setSearchOpen(true)}
            className="text-foreground/60 hover:text-primary transition-colors"
            aria-label="Search"
          >
            <Search size={20} />
          </button>
          <Link
            to="/contact"
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity glow"
          >
            Get Started
          </Link>
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
            <div className="flex flex-col gap-4 px-6 py-6">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`transition-colors ${
                    location.pathname === link.href
                      ? "text-primary font-medium"
                      : "text-foreground/70 hover:text-primary"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                to="/contact"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg bg-primary px-5 py-2.5 text-center text-sm font-medium text-primary-foreground"
              >
                Get Started
              </Link>
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
