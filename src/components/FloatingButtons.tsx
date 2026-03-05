import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  WHATSAPP_DEFAULT_MESSAGE,
  WHATSAPP_PHONE_INTERNATIONAL,
} from "@/lib/contact";

const FloatingButtons = () => {
  const [showScroll, setShowScroll] = useState(false);
  const whatsappMessage = encodeURIComponent(WHATSAPP_DEFAULT_MESSAGE);

  useEffect(() => {
    const onScroll = () => setShowScroll(window.scrollY > 300);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-3 sm:bottom-6 sm:right-6">
      <AnimatePresence>
        {showScroll && (
          <motion.button
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-muted border border-border text-foreground hover:bg-primary hover:text-primary-foreground transition-colors shadow-lg"
            aria-label="Scroll to top"
          >
            <ArrowUp size={20} />
          </motion.button>
        )}
      </AnimatePresence>
      <motion.a
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1 }}
        href={`https://wa.me/${WHATSAPP_PHONE_INTERNATIONAL}?text=${whatsappMessage}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-12 w-12 items-center justify-center rounded-full shadow-lg hover:scale-105 transition-transform"
        style={{ backgroundColor: "#25D366" }}
        aria-label="Chat on WhatsApp"
        title="Chat on WhatsApp"
      >
        <svg viewBox="0 0 32 32" width="24" height="24" fill="white">
          <path d="M16.004 0h-.008C7.174 0 0 7.176 0 16c0 3.5 1.128 6.744 3.046 9.378L1.054 31.29l6.118-1.958A15.9 15.9 0 0016.004 32C24.826 32 32 24.822 32 16S24.826 0 16.004 0zm9.31 22.598c-.39 1.1-1.932 2.012-3.182 2.278-.856.18-1.974.324-5.74-1.234-4.818-1.994-7.92-6.878-8.162-7.196-.232-.318-1.952-2.6-1.952-4.958s1.234-3.516 1.672-3.996c.39-.428 1.026-.636 1.634-.636.198 0 .376.01.536.018.438.02.658.046.948.734.362.858 1.246 3.038 1.354 3.26.11.222.222.52.072.818-.14.306-.264.442-.486.698-.222.256-.432.452-.654.728-.202.242-.43.502-.182.94.248.436 1.102 1.818 2.368 2.946 1.628 1.452 2.998 1.902 3.424 2.112.306.152.67.128.928-.144.326-.348.73-.926 1.14-1.496.292-.406.66-.458.998-.306.342.144 2.164 1.022 2.536 1.208.372.186.618.278.71.434.088.156.088.904-.302 2.002z" />
        </svg>
      </motion.a>
    </div>
  );
};

export default FloatingButtons;
