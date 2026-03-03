import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Settings, X } from "lucide-react";

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem("cookie-consent");
    if (!accepted) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem("cookie-consent", "accepted");
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem("cookie-consent", "declined");
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[59] bg-foreground/30 backdrop-blur-sm"
            onClick={decline}
          />

          {/* Popup */}
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 260 }}
            className="fixed bottom-0 left-0 right-0 z-[60] mx-auto max-w-4xl md:bottom-6 md:left-6 md:right-6 md:rounded-2xl rounded-t-2xl border border-border bg-background shadow-2xl overflow-hidden"
          >
            {/* Gradient accent */}
            <div className="h-1.5 w-full bg-gradient-to-r from-primary via-secondary to-primary" />

            <div className="p-6 md:p-8">
              <button
                onClick={decline}
                className="absolute top-4 right-4 h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>

              <div className="flex flex-col md:flex-row md:items-center gap-6">
                {/* Icon + Text */}
                <div className="flex items-start gap-4 flex-1">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <ShieldCheck size={24} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display text-lg font-bold text-foreground mb-1">
                      Cookie Preferences
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      We use cookies and similar technologies to enhance your experience, analyze site traffic, and personalize content. You can manage your preferences or accept all cookies to get the best experience on our website.
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 md:shrink-0">
                  <button
                    onClick={accept}
                    className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity whitespace-nowrap"
                  >
                    Accept All Cookies
                  </button>
                  <button
                    onClick={decline}
                    className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors whitespace-nowrap flex items-center justify-center gap-2"
                  >
                    <Settings size={14} />
                    Manage Preferences
                  </button>
                </div>
              </div>

              {/* Footer links */}
              <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <a href="/contact" className="hover:text-primary transition-colors underline underline-offset-2">
                  Privacy Policy
                </a>
                <a href="/contact" className="hover:text-primary transition-colors underline underline-offset-2">
                  Cookie Policy
                </a>
                <span className="ml-auto">Powered by Zyllo Tech</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CookieConsent;
