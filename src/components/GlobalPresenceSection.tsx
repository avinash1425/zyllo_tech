import { motion } from "framer-motion";
import { Globe2, MapPin } from "lucide-react";
import Globe from "@/components/ui/globe";

const points = [
  "Remote-first delivery with timezone overlap",
  "Clear sprint communication and weekly demos",
  "Design, engineering, and QA in one execution team",
];

const GlobalPresenceSection = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[hsl(24,95%,97%)] via-background to-[hsl(195,55%,96%)] py-16 md:py-20">
      <div className="pointer-events-none absolute -left-20 top-0 h-56 w-56 rounded-full bg-primary/12 blur-3xl" />
      <div className="pointer-events-none absolute -right-12 bottom-0 h-56 w-56 rounded-full bg-[hsl(195,55%,42%,0.2)] blur-3xl" />

      <div className="container relative mx-auto px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
              <Globe2 size={14} />
              Global Delivery
            </p>
            <h2 className="mt-4 font-display text-3xl font-bold text-foreground md:text-4xl">
              Built in Bengaluru, Delivered Worldwide
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
              We collaborate with startups and enterprises across regions, while keeping delivery
              quality high and timelines predictable.
            </p>

            <div className="mt-6 space-y-3">
              {points.map((point) => (
                <div
                  key={point}
                  className="rounded-lg border border-border/80 bg-white/75 px-4 py-3 text-sm text-foreground"
                >
                  {point}
                </div>
              ))}
            </div>

            <div className="mt-5 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin size={16} className="text-primary" />
              Bengaluru, India
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08, duration: 0.5 }}
            className="rounded-3xl border border-border/80 bg-white/85 p-5 shadow-[0_18px_40px_hsl(215_30%_16%_/_0.08)] md:p-7"
          >
            <Globe className="min-h-[320px]" size={296} />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default GlobalPresenceSection;
