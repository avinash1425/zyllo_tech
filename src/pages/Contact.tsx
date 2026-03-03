import { useState, useRef, type ComponentType } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Mail,
  Phone,
  MapPin,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import { useToast } from "@/hooks/use-toast";
import { CONTACT_PHONE_DISPLAY, CONTACT_PHONE_E164 } from "@/lib/contact";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  email: string;
  phone: string;
  subject: string;
  service: string;
  message: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
}

interface ContactInfoItem {
  icon: React.ElementType;
  label: string;
  value: string;
  description: string;
  href?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICES = [
  "Select a service...",
  "Software Development",
  "AI & Machine Learning",
  "Cloud Solutions",
  "UI/UX Design",
  "Digital Marketing",
  "IT Consulting",
  "Other",
];

const MAX_MESSAGE_LENGTH = 1000;

const CONTACT_INFO: ContactInfoItem[] = [
  {
    icon: Mail,
    label: "Email Us",
    value: "info@zyllotech.com",
    href: "mailto:info@zyllotech.com",
    description: "We reply within 24 hours",
  },
  {
    icon: Phone,
    label: "Call Us",
    value: CONTACT_PHONE_DISPLAY,
    href: `tel:${CONTACT_PHONE_E164}`,
    description: "Mon – Fri, 9 AM – 6 PM IST",
  },
  {
    icon: MapPin,
    label: "Our Office",
    value: "India",
    href: "https://maps.google.com/?q=India",
    description: "Visit us by appointment",
  },
  {
    icon: Clock,
    label: "Working Hours",
    value: "Mon – Fri: 9:00 AM – 6:00 PM IST",
    description: "Closed on weekends & public holidays",
  },
];

// ─── Validation ───────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+\d\s\-()]{7,20}$/;

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!form.name.trim() || form.name.trim().length < 2)
    errors.name = "Please enter your full name (at least 2 characters).";

  if (!form.email.trim() || !EMAIL_REGEX.test(form.email))
    errors.email = "Please enter a valid email address.";

  if (form.phone && !PHONE_REGEX.test(form.phone))
    errors.phone = "Please enter a valid phone number.";

  if (!form.subject.trim() || form.subject.trim().length < 3)
    errors.subject = "Please enter a subject (at least 3 characters).";

  if (!form.message.trim() || form.message.trim().length < 20)
    errors.message = "Please describe your inquiry (at least 20 characters).";

  return errors;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const FieldError = ({ id, message }: { id: string; message?: string }) => (
  <AnimatePresence>
    {message && (
      <motion.p
        key="err"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2 }}
        className="mt-1 flex items-center gap-1 text-xs text-destructive"
        id={id}
        role="alert"
        aria-live="polite"
      >
        <AlertCircle size={12} className="shrink-0" />
        {message}
      </motion.p>
    )}
  </AnimatePresence>
);

// ─── Page Component ───────────────────────────────────────────────────────────

const ContactPage = () => {
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  const emptyForm: FormState = {
    name: "",
    email: "",
    phone: "",
    subject: "",
    service: SERVICES[0],
    message: "",
  };

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Live per-field validation on blur
  const handleBlur = (field: keyof FormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const fieldErrors = validate(form);
    setErrors((prev) => ({ ...prev, [field]: fieldErrors[field as keyof FormErrors] }));
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));

    // Clear error as user types (if field was already touched)
    if (touched[name as keyof FormState]) {
      const updated = { ...form, [name]: value };
      const fieldErrors = validate(updated);
      setErrors((prev) => ({
        ...prev,
        [name]: fieldErrors[name as keyof FormErrors],
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all relevant fields as touched
    setTouched({ name: true, email: true, phone: true, subject: true, message: true });

    const fieldErrors = validate(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);

      // Focus first invalid field
      const firstKey = Object.keys(fieldErrors)[0];
      const el = formRef.current?.elements.namedItem(firstKey) as HTMLElement | null;
      el?.focus();
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    // Simulate network delay
    await new Promise((r) => setTimeout(r, 1800));

    setIsSubmitting(false);
    setIsSuccess(true);
    setForm(emptyForm);
    setTouched({});

    toast({
      title: "Message Sent! 🎉",
      description: "Thank you for reaching out. We'll get back to you within 24 hours.",
    });
  };

  const inputBase =
    "w-full rounded-lg border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-all";
  const inputNormal = `${inputBase} border-border focus:ring-primary/50 focus:border-primary/50`;
  const inputError = `${inputBase} border-destructive/60 focus:ring-destructive/30 focus:border-destructive/60`;

  const getInputClass = (field: keyof FormErrors) =>
    touched[field] && errors[field] ? inputError : inputNormal;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="Contact"
        highlight="Us"
        description="Have a project in mind? We'd love to hear from you. Share your idea and we'll get back within 24 hours."
        breadcrumb="Contact"
      />

      {/* ── Contact Info Cards ── */}
      <section className="py-16 border-b border-border">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CONTACT_INFO.map((item, i) => (
              item.href ? (
                <motion.a
                  key={item.label}
                  href={item.href}
                  target={item.href.startsWith("http") ? "_blank" : undefined}
                  rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-all"
                  aria-label={`${item.label}: ${item.value}`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <item.icon size={22} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      {item.label}
                    </p>
                    <p className="font-display font-semibold text-foreground text-sm leading-snug">
                      {item.value}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                  </div>
                </motion.a>
              ) : (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-background p-6"
                  aria-label={`${item.label}: ${item.value}`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors">
                    <item.icon size={22} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      {item.label}
                    </p>
                    <p className="font-display font-semibold text-foreground text-sm leading-snug">
                      {item.value}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                  </div>
                </motion.div>
              )
            ))}
          </div>
        </div>
      </section>

      {/* ── Form + Map ── */}
      <section className="py-24">
        <div className="container mx-auto px-6">
          <div className="grid gap-16 lg:grid-cols-2 items-start">

            {/* Left — intro + map */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-8"
            >
              <div>
                <h2 className="font-display text-3xl font-bold text-foreground mb-4">
                  Let's Start a <span className="text-gradient">Conversation</span>
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Whether you need a custom software solution, want to explore AI capabilities,
                  or simply have a question — our team is ready to help. Fill out the form and
                  we'll respond within one business day.
                </p>
              </div>

              {/* Trust badges */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { stat: "24h", label: "Response Time" },
                  { stat: "100+", label: "Projects Delivered" },
                  { stat: "98%", label: "Client Satisfaction" },
                ].map((b) => (
                  <div
                    key={b.label}
                    className="rounded-xl border border-border bg-muted/30 p-4 text-center"
                  >
                    <p className="font-display text-2xl font-bold text-primary">{b.stat}</p>
                    <p className="text-xs text-muted-foreground mt-1">{b.label}</p>
                  </div>
                ))}
              </div>

              {/* Google Map embed */}
              <div className="rounded-2xl overflow-hidden border border-border shadow-sm h-64">
                <iframe
                  title="Zyllo Tech Office Location"
                  src="https://www.google.com/maps?q=India&output=embed"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  aria-label="Map showing Zyllo Tech office location in India"
                />
              </div>
            </motion.div>

            {/* Right — form */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <AnimatePresence mode="wait">
                {isSuccess ? (
                  /* ── Success State ── */
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="rounded-2xl border border-border bg-muted/30 p-10 shadow-sm flex flex-col items-center text-center gap-5"
                    role="alert"
                    aria-live="polite"
                  >
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                      <CheckCircle2 size={36} className="text-primary" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-display text-2xl font-bold text-foreground mb-2">
                        Message Received!
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed max-w-sm">
                        Thank you for reaching out. Our team will review your inquiry and get
                        back to you within 24 hours.
                      </p>
                    </div>
                    <button
                      onClick={() => setIsSuccess(false)}
                      className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Send Another Message
                    </button>
                  </motion.div>
                ) : (
                  /* ── Form ── */
                  <motion.form
                    key="form"
                    ref={formRef}
                    onSubmit={handleSubmit}
                    noValidate
                    aria-label="Contact form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="rounded-2xl border border-border bg-muted/30 p-8 space-y-5 shadow-sm"
                  >
                    <div>
                      <h3 className="font-display text-2xl font-bold text-foreground">
                        Send Us a Message
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Fields marked <span aria-hidden="true" className="text-destructive">*</span> are required.
                      </p>
                    </div>

                    {/* Name + Email */}
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="name" className="text-sm font-medium text-foreground mb-1 block">
                          Full Name <span aria-hidden="true" className="text-destructive">*</span>
                        </label>
                        <input
                          id="name"
                          name="name"
                          type="text"
                          autoComplete="name"
                          value={form.name}
                          onChange={handleChange}
                          onBlur={() => handleBlur("name")}
                          className={getInputClass("name")}
                          placeholder="Jane Smith"
                          aria-required="true"
                          aria-invalid={!!(touched.name && errors.name)}
                          aria-describedby={errors.name ? "name-error" : undefined}
                        />
                        <FieldError id="name-error" message={touched.name ? errors.name : undefined} />
                      </div>

                      <div>
                        <label htmlFor="email" className="text-sm font-medium text-foreground mb-1 block">
                          Email Address <span aria-hidden="true" className="text-destructive">*</span>
                        </label>
                        <input
                          id="email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          value={form.email}
                          onChange={handleChange}
                          onBlur={() => handleBlur("email")}
                          className={getInputClass("email")}
                          placeholder="jane@company.com"
                          aria-required="true"
                          aria-invalid={!!(touched.email && errors.email)}
                          aria-describedby={errors.email ? "email-error" : undefined}
                        />
                        <FieldError id="email-error" message={touched.email ? errors.email : undefined} />
                      </div>
                    </div>

                    {/* Phone + Service */}
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="phone" className="text-sm font-medium text-foreground mb-1 block">
                          Phone <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                        </label>
                        <input
                          id="phone"
                          name="phone"
                          type="tel"
                          autoComplete="tel"
                          value={form.phone}
                          onChange={handleChange}
                          onBlur={() => handleBlur("phone")}
                          className={getInputClass("phone")}
                          placeholder="+91 XXXXX XXXXX"
                          aria-invalid={!!(touched.phone && errors.phone)}
                          aria-describedby={errors.phone ? "phone-error" : undefined}
                        />
                        <FieldError id="phone-error" message={touched.phone ? errors.phone : undefined} />
                      </div>

                      <div>
                        <label htmlFor="service" className="text-sm font-medium text-foreground mb-1 block">
                          Service Interested In
                        </label>
                        <div className="relative">
                          <select
                            id="service"
                            name="service"
                            value={form.service}
                            onChange={handleChange}
                            className={`${inputNormal} appearance-none pr-10 cursor-pointer`}
                          >
                            {SERVICES.map((s) => (
                              <option key={s} value={s} disabled={s === SERVICES[0]}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={16}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Subject */}
                    <div>
                      <label htmlFor="subject" className="text-sm font-medium text-foreground mb-1 block">
                        Subject <span aria-hidden="true" className="text-destructive">*</span>
                      </label>
                      <input
                        id="subject"
                        name="subject"
                        type="text"
                        value={form.subject}
                        onChange={handleChange}
                        onBlur={() => handleBlur("subject")}
                        className={getInputClass("subject")}
                        placeholder="eg: Project inquiry for e-commerce platform"
                        aria-required="true"
                        aria-invalid={!!(touched.subject && errors.subject)}
                        aria-describedby={errors.subject ? "subject-error" : undefined}
                      />
                      <FieldError id="subject-error" message={touched.subject ? errors.subject : undefined} />
                    </div>

                    {/* Message */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="message" className="text-sm font-medium text-foreground">
                          Message <span aria-hidden="true" className="text-destructive">*</span>
                        </label>
                        <span
                          className={`text-xs tabular-nums ${form.message.length > MAX_MESSAGE_LENGTH * 0.9
                              ? "text-destructive"
                              : "text-muted-foreground"
                            }`}
                          aria-live="polite"
                          aria-label={`${form.message.length} of ${MAX_MESSAGE_LENGTH} characters used`}
                        >
                          {form.message.length}/{MAX_MESSAGE_LENGTH}
                        </span>
                      </div>
                      <textarea
                        id="message"
                        name="message"
                        rows={5}
                        maxLength={MAX_MESSAGE_LENGTH}
                        value={form.message}
                        onChange={handleChange}
                        onBlur={() => handleBlur("message")}
                        className={`${getInputClass("message")} resize-none`}
                        placeholder="Tell us about your project — goals, timeline, budget range..."
                        aria-required="true"
                        aria-invalid={!!(touched.message && errors.message)}
                        aria-describedby={errors.message ? "message-error" : undefined}
                      />
                      <FieldError id="message-error" message={touched.message ? errors.message : undefined} />
                    </div>

                    {/* Privacy note */}
                    <p className="text-xs text-muted-foreground">
                      By submitting this form you agree to our{" "}
                      <Link to="/privacy-policy" className="underline underline-offset-2 hover:text-foreground transition-colors">
                        Privacy Policy
                      </Link>
                      . We'll never share your information with third parties.
                    </p>

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 active:scale-[.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all glow"
                      aria-disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                          Sending…
                        </>
                      ) : (
                        <>
                          <Send size={16} aria-hidden="true" />
                          Send Message
                        </>
                      )}
                    </button>
                  </motion.form>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default ContactPage;
