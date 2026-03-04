import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "react-router-dom";
import infinityFavicon from "@/assets/zyllo-infinity-loader.png";

const LoadingScreen = ({ onComplete, quick = false }: { onComplete: () => void; quick?: boolean }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const step = quick ? 8 : 2;
    const tick = quick ? 16 : 30;
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + step;
      });
    }, tick);
    return () => clearInterval(interval);
  }, [quick]);

  useEffect(() => {
    if (progress >= 100) {
      const timer = setTimeout(onComplete, quick ? 140 : 320);
      return () => clearTimeout(timer);
    }
  }, [progress, onComplete, quick]);

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-secondary"
      exit={{ opacity: 0 }}
      transition={{ duration: quick ? 0.2 : 0.45 }}
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: quick ? 0.25 : 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        className="relative mb-7"
      >
        <motion.div
          className="absolute inset-[-8px] rounded-full border border-primary/30"
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
        />
        <motion.img
          src={infinityFavicon}
          alt="Zyllo Tech Infinity"
          className="h-16 w-16 object-contain"
          animate={{
            scale: [1, 1.08, 1],
            rotate: [0, 12, 0, -12, 0],
            filter: ["drop-shadow(0 0 0px hsl(24,95%,50%))", "drop-shadow(0 0 14px hsl(24,95%,50%))", "drop-shadow(0 0 0px hsl(24,95%,50%))"],
          }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full"
          style={{ width: `${progress}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-4 text-white/40 text-xs tracking-widest uppercase"
      >
        Loading Experience...
      </motion.p>
    </motion.div>
  );
};

const AppLoader = ({ children }: { children: React.ReactNode }) => {
  const [initialLoading, setInitialLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const location = useLocation();

  const handleInitialComplete = useCallback(() => setInitialLoading(false), []);

  useEffect(() => {
    if (initialLoading) return;
    setRouteLoading(true);
    const timer = setTimeout(() => setRouteLoading(false), 240);
    return () => clearTimeout(timer);
  }, [location.pathname, initialLoading]);

  return (
    <>
      <AnimatePresence mode="wait">
        {initialLoading && <LoadingScreen onComplete={handleInitialComplete} />}
        {!initialLoading && routeLoading && (
          <LoadingScreen key={location.pathname} onComplete={() => setRouteLoading(false)} quick />
        )}
      </AnimatePresence>
      {!initialLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {children}
        </motion.div>
      )}
    </>
  );
};

export default AppLoader;
