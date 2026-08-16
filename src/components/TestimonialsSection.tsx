import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, ChevronLeft, ChevronRight, Quote } from "lucide-react";

const testimonials = [
  {
    name: "Rajesh Kumar",
    role: "CTO",
    company: "FinEdge Solutions",
    industry: "Banking & Financial",
    rating: 5,
    text: "Zyllo Tech delivered our core banking dashboard on time and beyond expectations. Their team's deep understanding of fintech requirements and attention to security best practices made the entire engagement seamless. We've seen a 40% improvement in operational efficiency.",
    initials: "RK",
    color: "bg-blue-500",
  },
  {
    name: "Priya Sharma",
    role: "Head of Product",
    company: "MedCare Innovations",
    industry: "Healthcare",
    rating: 5,
    text: "The patient management platform Zyllo Tech built for us transformed our workflow completely. Their AI-driven appointment scheduling alone reduced no-shows by 35%. The team was proactive, communicative, and genuinely invested in our success.",
    initials: "PS",
    color: "bg-teal-600",
  },
  {
    name: "Ahmed Al-Rashid",
    role: "CEO",
    company: "RetailX Global",
    industry: "Retail & E-Commerce",
    rating: 5,
    text: "We needed a scalable e-commerce platform capable of handling peak-season traffic spikes. Zyllo Tech's cloud architecture handled 10x our normal load without a hiccup during our biggest sale event. Exceptional engineering team.",
    initials: "AA",
    color: "bg-orange-500",
  },
  {
    name: "Sanjay Mehta",
    role: "VP Engineering",
    company: "LogiTrack Systems",
    industry: "Logistics & Transport",
    rating: 5,
    text: "Zyllo Tech's real-time fleet tracking and route optimization solution cut our delivery costs by 28%. The mobile app they built for our drivers is intuitive and has dramatically improved on-ground efficiency. Highly recommend their expertise.",
    initials: "SM",
    color: "bg-purple-600",
  },
  {
    name: "Li Wei",
    role: "Director of Digital",
    company: "EduSpark Academy",
    industry: "Education",
    rating: 5,
    text: "Building an interactive learning platform with live classes, assessments, and progress tracking seemed daunting. Zyllo Tech made it effortless. Our student engagement rates jumped by 60% within the first month of launch.",
    initials: "LW",
    color: "bg-emerald-600",
  },
];

const StarRating = ({ rating }: { rating: number }) => (
  <div className="flex gap-0.5">
    {Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        size={14}
        className={i < rating ? "fill-primary text-primary" : "text-muted-foreground"}
      />
    ))}
  </div>
);

const TestimonialsSection = () => {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);

  const next = useCallback(() => {
    setDirection(1);
    setCurrent((prev) => (prev + 1) % testimonials.length);
  }, []);

  const prev = () => {
    setDirection(-1);
    setCurrent((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  useEffect(() => {
    const timer = setInterval(next, 7000);
    return () => clearInterval(timer);
  }, [next]);

  const testimonial = testimonials[current];

  return (
    <section className="py-16 lg:py-20 bg-muted/50">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-primary">
            Client Stories
          </span>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
            What Our <span className="text-primary">Clients Say</span>
          </h2>
          <p className="mt-3 mx-auto max-w-xl text-muted-foreground">
            Trusted by businesses across industries to deliver real results.
          </p>
        </motion.div>

        <div className="relative max-w-3xl mx-auto">
          {/* Main testimonial card */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-background shadow-sm min-h-[280px] flex items-center">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={current}
                custom={direction}
                initial={{ opacity: 0, x: direction * 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -60 }}
                transition={{ duration: 0.4, ease: "easeInOut" }}
                className="w-full p-8 md:p-12"
              >
                <Quote size={32} className="text-primary/20 mb-4" />
                <p className="text-foreground leading-relaxed text-base md:text-lg mb-8 italic">
                  "{testimonial.text}"
                </p>
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full text-white font-bold text-sm flex-shrink-0 ${testimonial.color}`}
                  >
                    {testimonial.initials}
                  </div>
                  <div>
                    <div className="font-display font-semibold text-foreground">
                      {testimonial.name}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {testimonial.role} · {testimonial.company}
                    </div>
                    <div className="mt-1">
                      <StarRating rating={testimonial.rating} />
                    </div>
                  </div>
                  <div className="ml-auto hidden sm:block">
                    <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      {testimonial.industry}
                    </span>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <button
              onClick={prev}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground hover:border-primary hover:text-primary transition-colors"
              aria-label="Previous testimonial"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="flex gap-2">
              {testimonials.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setDirection(i > current ? 1 : -1);
                    setCurrent(i);
                  }}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === current ? "w-6 bg-primary" : "w-2 bg-border"
                  }`}
                  aria-label={`Go to testimonial ${i + 1}`}
                />
              ))}
            </div>

            <button
              onClick={next}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground hover:border-primary hover:text-primary transition-colors"
              aria-label="Next testimonial"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center"
        >
          {[
            { value: "30+", label: "Happy Clients" },
            { value: "50+", label: "Projects Delivered" },
            { value: "98%", label: "Client Satisfaction" },
            { value: "6+", label: "Countries Served" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-border bg-background p-5 shadow-sm">
              <div className="font-display text-2xl font-bold text-primary">{stat.value}</div>
              <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
