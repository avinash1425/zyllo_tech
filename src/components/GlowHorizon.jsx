import { motion } from "framer-motion";

// Animated glowing-horizon hero background — inspired by 21st.dev's "Glow
// Horizon" component, rebuilt in Zyllo's orange/navy palette using
// framer-motion since the original component source wasn't directly
// accessible. Smooth pulsing/breathing light bands sweep behind the hero
// content instead of a static glow blob.
export default function GlowHorizon() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Wide ambient orange glow, top */}
      <motion.div
        className="absolute -top-1/3 right-[-10%] h-[60rem] w-[60rem] rounded-full bg-gradient-to-br from-[#1f4693] via-[#5b7fd4] to-transparent blur-[80px]"
        animate={{ opacity: [0.3, 0.45, 0.3], scale: [1, 1.06, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Secondary orange sweep */}
      <motion.div
        className="absolute -top-1/4 right-0 h-[40rem] w-[40rem] rounded-full bg-gradient-to-br from-[#f7941e] via-[#f7941e]/40 to-transparent blur-[100px]"
        animate={{ opacity: [0.1, 0.2, 0.1], x: [0, -30, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      />

      {/* Lower navy glow */}
      <motion.div
        className="absolute bottom-0 left-0 h-[26rem] w-[26rem] rounded-full bg-[#1f4693] blur-[110px]"
        animate={{ opacity: [0.08, 0.16, 0.08] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
      />

      {/* Thin animated horizon light line */}
      <motion.div
        className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-[#5b7fd4]/40 to-transparent"
        animate={{ opacity: [0.2, 0.6, 0.2], scaleX: [0.85, 1, 0.85] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
