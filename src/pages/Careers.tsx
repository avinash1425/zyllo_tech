import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import {
  MapPin,
  Clock3,
  Briefcase,
  Upload,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Rocket,
  Users,
  GraduationCap,
  Star,
  Lightbulb,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import careersBanner from "@/assets/careers-banner.jpg";
import { useToast } from "@/hooks/use-toast";

const openings = [
  {
    title: "Senior Full Stack Developer",
    location: "India / Remote",
    type: "Full Time",
    experience: "5+ Years",
    skills: ["React", "Node.js", "TypeScript", "PostgreSQL", "AWS"],
    domain: "Web Engineering",
  },
  {
    title: "Cloud Solutions Engineer",
    location: "India / Remote",
    type: "Full Time",
    experience: "4+ Years",
    skills: ["AWS / GCP / Azure", "Terraform", "Kubernetes", "CI/CD", "Linux"],
    domain: "Cloud & DevOps",
  },
];

const ACCEPTED_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const ALLOWED_EXTENSIONS = Object.keys(ACCEPTED_MIME_TYPES); // [".pdf", ".doc", ".docx"]
const MAX_RESUME_SIZE = 5 * 1024 * 1024; // 5 MB
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_\-. ]+$/; // no path-traversal or shell chars

/**
 * Validates the uploaded resume file.
 * Requires BOTH a whitelisted extension AND its matching MIME type to match
 * (defense-in-depth — prevents renamed executables or spoofed extensions).
 * Also rejects filenames containing path-traversal or unusual characters.
 */
const isSupportedResume = (file: File): boolean => {
  const name = file.name;
  if (!SAFE_FILENAME_RE.test(name)) return false;                  // suspicious chars
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();     // take last extension
  if (!ALLOWED_EXTENSIONS.includes(ext)) return false;             // unknown extension
  const expectedMime = ACCEPTED_MIME_TYPES[ext];
  return file.type === expectedMime;                               // MIME must match ext
};

const careerFormSchema = z.object({
  fullName: z
    .string().trim()
    .min(2, "Please enter your full name.")
    .max(100, "Name must be 100 characters or less.")
    .regex(/^[\p{L}\p{M}'\- ]+$/u, "Name contains invalid characters."),
  email: z.string().trim().email("Please enter a valid email address.").max(254),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[-()\d\s]{8,20}$/, "Please enter a valid phone number."),
  role: z.string().trim().min(2, "Please select a role.").max(120),
  location: z
    .string().trim()
    .min(2, "Please enter your current location.")
    .max(100, "Location must be 100 characters or less."),
  experience: z
    .string().trim()
    .min(1, "Please enter your experience.")
    .max(50, "Experience must be 50 characters or less."),
  linkedIn: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (val) => !val || /^https:\/\/(www\.)?linkedin\.com\/.+/i.test(val),
      "Please enter a valid LinkedIn profile URL (linkedin.com).",
    ),
  coverLetter: z
    .string()
    .trim()
    .min(40, "Please add at least 40 characters.")
    .max(1200, "Cover letter must be 1200 characters or less."),
  resume: z
    .custom<FileList>((files) => files instanceof FileList, "Please upload your resume.")
    .refine((files) => files.length === 1, "Please upload one resume file.")
    .refine((files) => files[0].size <= MAX_RESUME_SIZE, "Resume must be 5 MB or smaller.")
    .refine(
      (files) => SAFE_FILENAME_RE.test(files[0].name),
      "Filename contains invalid characters. Rename the file and try again.",
    )
    .refine(
      (files) => isSupportedResume(files[0]),
      "Only PDF, DOC, or DOCX files are accepted. Ensure the file type matches its extension.",
    ),
  consent: z.literal(true, {
    errorMap: () => ({ message: "Please confirm the data consent checkbox." }),
  }),
});

type CareerFormData = z.infer<typeof careerFormSchema>;

import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const CareersPage = () => {
  const { toast } = useToast();
  const formRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
    reset,
  } = useForm<CareerFormData>({
    resolver: zodResolver(careerFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      role: "",
      location: "",
      experience: "",
      linkedIn: "",
      coverLetter: "",
      consent: undefined as unknown as true,
    },
  });

  const applyForRole = (title: string) => {
    setValue("role", title, { shouldValidate: true, shouldDirty: true });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onSubmit = async (data: CareerFormData) => {
    setSubmitting(true);
    try {
      // Upload resume
      const file = data.resume[0];
      // Extract and whitelist the extension — never trust file.name blindly
      const rawExt = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const safeExt = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt.slice(1) : null;
      if (!safeExt) throw new Error("Invalid file type.");
      const filePath = `${crypto.randomUUID()}.${safeExt}`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      // Save application
      const { error } = await supabase.from("career_applications").insert({
        full_name: data.fullName.trim(),
        email: data.email.trim(),
        phone: data.phone.trim(),
        role: data.role.trim(),
        location: data.location.trim(),
        experience: data.experience.trim(),
        linkedin_url: data.linkedIn?.trim() || null,
        cover_letter: data.coverLetter.trim(),
        resume_path: filePath,
        consent: data.consent,
      });
      if (error) throw error;

      // Send admin notification (fire and forget)
      supabase.functions.invoke("notify-admin", {
        body: { type: "career", data: { fullName: data.fullName, email: data.email, phone: data.phone, role: data.role, location: data.location, experience: data.experience, linkedIn: data.linkedIn || "", coverLetter: data.coverLetter } },
      }).catch(() => {});

      reset();
      toast({
        title: "Application submitted",
        description: "Our recruitment team will review your profile and contact you soon.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast({
        title: "Submission failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Software Engineering Jobs & OJT Programme | Zyllo Tech India"
        description="Join Zyllo Tech — hiring Senior Full Stack Developers, Cloud Engineers, Cybersecurity Engineers, AI/ML Engineers, DevOps Engineers, and QA Automation Engineers. Also offering a Graduate OJT programme for final-year students and fresh graduates across India."
        canonical="/careers"
        keywords="software engineering jobs India, IT jobs Hyderabad, cybersecurity engineer jobs India, cloud engineer jobs India, AI ML engineer jobs, QA automation engineer jobs, OJT training India, fresher software jobs Hyderabad, graduate IT programme India"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Careers", url: `${SITE_URL}/careers` },
        ])}
      />
      <Navbar />
      <PageHero
        title="Build Your"
        highlight="Career"
        description="Work with Zyllo Tech on AI, agent automation, and cloud-native products that solve real business problems."
        breadcrumb="Careers"
      />

      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-6">
                Why professionals choose <span className="text-gradient">Zyllo Tech</span>
              </h2>
              <div className="space-y-4 text-muted-foreground">
                <div className="flex items-start gap-3">
                  <Rocket className="h-5 w-5 mt-0.5 text-primary" />
                  <p>High-impact product work in AI-powered automation and cloud-native engineering.</p>
                </div>
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 mt-0.5 text-primary" />
                  <p>Transparent culture, mentorship support, and clear growth tracks.</p>
                </div>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 mt-0.5 text-primary" />
                  <p>Flexible remote-friendly work, strong engineering practices, and ownership mindset.</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="overflow-hidden rounded-2xl border border-border"
            >
              <img src={careersBanner} alt="Careers at Zyllo Tech" className="h-80 w-full object-cover" />
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-muted/40 border-y border-border">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Open Roles</p>
            <h3 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">Current Opportunities</h3>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {openings.map((job, i) => (
              <motion.article
                key={job.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="flex flex-col rounded-2xl border border-border bg-background p-6 shadow-sm hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h4 className="font-display text-xl font-semibold text-foreground leading-snug">{job.title}</h4>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">{job.domain}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-4">
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-primary" />{job.location}</span>
                  <span className="inline-flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5 text-primary" />{job.type}</span>
                  <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-primary" />{job.experience}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-6">
                  {job.skills.map((skill) => (
                    <span key={skill} className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {skill}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => applyForRole(job.title)}
                  className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  Apply for this role <ArrowRight className="h-4 w-4" />
                </button>
              </motion.article>
            ))}
          </div>

        </div>
      </section>

      {/* OJT / Graduate Programme */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-background to-[hsl(195,55%,42%,0.06)] p-8 md:p-10"
          >
            <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary mb-4">
                  <GraduationCap className="h-4 w-4" /> Graduate & OJT Programme
                </div>
                <h3 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-3">
                  Starting Your Career? We Want to Hear From You.
                </h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Whether you are a final-year student, a recent B.Tech / MCA / BCA / BSc graduate, or looking for On-the-Job Training (OJT) as part of your academic programme — Zyllo Tech welcomes driven learners who want real engineering experience, not just theory.
                </p>
                <div className="grid gap-4 sm:grid-cols-3 mb-8">
                  {[
                    {
                      icon: <Lightbulb className="h-5 w-5 text-primary" />,
                      title: "Learn by Doing",
                      text: "Work on live client projects in web, mobile, cloud, and AI — not dummy assignments.",
                    },
                    {
                      icon: <Users className="h-5 w-5 text-primary" />,
                      title: "Mentored Teams",
                      text: "Paired with senior engineers who review your code, guide architecture decisions, and support growth.",
                    },
                    {
                      icon: <Star className="h-5 w-5 text-primary" />,
                      title: "Path to Full-Time",
                      text: "Strong OJT performers are evaluated for full-time offers at the end of the programme.",
                    },
                  ].map((item) => (
                    <div key={item.title} className="rounded-xl border border-border bg-background p-4">
                      <div className="mb-2">{item.icon}</div>
                      <p className="text-sm font-semibold text-foreground mb-1">{item.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.text}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-muted/40 px-5 py-4 text-sm text-muted-foreground mb-6">
                  <p className="font-medium text-foreground mb-1">Programme Details</p>
                  <ul className="space-y-1 text-xs">
                    <li>• Duration: 3 – 6 months (flexible based on academic requirement)</li>
                    <li>• Mode: Hybrid / Remote (India)</li>
                    <li>• Domains: Web Development, Mobile Apps, Cloud & DevOps, Data & AI, QA Engineering</li>
                    <li>• Eligibility: Final-year students or recent graduates in CS / IT / Engineering / related fields</li>
                    <li>• Certificate of completion issued; OJT letters provided for college requirements</li>
                  </ul>
                </div>
                <button
                  onClick={() => applyForRole("Graduate OJT Programme")}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  Apply for OJT Programme <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section ref={formRef} className="py-20">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-background p-6 sm:p-8 shadow-sm">
            <div className="mb-8">
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-foreground">Career Application Form</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Complete the form below. Resume upload supports PDF, DOC, DOCX up to 5MB.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-foreground">Full Name</label>
                  <input id="fullName" {...register("fullName")} className={fieldClass} placeholder="Your full name" />
                  {errors.fullName && <p className="mt-1 text-xs text-destructive">{errors.fullName.message}</p>}
                </div>
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">Email Address</label>
                  <input id="email" type="email" {...register("email")} className={fieldClass} placeholder="you@company.com" />
                  {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-foreground">Phone Number</label>
                  <input id="phone" {...register("phone")} className={fieldClass} placeholder="+91" />
                  {errors.phone && <p className="mt-1 text-xs text-destructive">{errors.phone.message}</p>}
                </div>
                <div>
                  <label htmlFor="role" className="mb-1.5 block text-sm font-medium text-foreground">Role Applying For</label>
                  <select id="role" {...register("role")} className={fieldClass}>
                    <option value="">Select role</option>
                    {openings.map((job) => (
                      <option key={job.title} value={job.title}>{job.title}</option>
                    ))}
                    <option value="Graduate OJT Programme">Graduate OJT Programme</option>
                    <option value="Other / Open Application">Other / Open Application</option>
                  </select>
                  {errors.role && <p className="mt-1 text-xs text-destructive">{errors.role.message}</p>}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="location" className="mb-1.5 block text-sm font-medium text-foreground">Current Location</label>
                  <input id="location" {...register("location")} className={fieldClass} placeholder="City, Country" />
                  {errors.location && <p className="mt-1 text-xs text-destructive">{errors.location.message}</p>}
                </div>
                <div>
                  <label htmlFor="experience" className="mb-1.5 block text-sm font-medium text-foreground">Experience</label>
                  <input id="experience" {...register("experience")} className={fieldClass} placeholder="e.g. 4 years" />
                  {errors.experience && <p className="mt-1 text-xs text-destructive">{errors.experience.message}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="linkedIn" className="mb-1.5 block text-sm font-medium text-foreground">LinkedIn URL (optional)</label>
                <input id="linkedIn" {...register("linkedIn")} className={fieldClass} placeholder="https://linkedin.com/in/your-profile" />
                {errors.linkedIn && <p className="mt-1 text-xs text-destructive">{errors.linkedIn.message}</p>}
              </div>

              <div>
                <label htmlFor="coverLetter" className="mb-1.5 block text-sm font-medium text-foreground">Cover Letter</label>
                <textarea
                  id="coverLetter"
                  rows={5}
                  {...register("coverLetter")}
                  className={fieldClass}
                  placeholder="Tell us why you are a strong fit for this role."
                />
                {errors.coverLetter && <p className="mt-1 text-xs text-destructive">{errors.coverLetter.message}</p>}
              </div>

              <div>
                <label htmlFor="resume" className="mb-1.5 block text-sm font-medium text-foreground">Resume</label>
                <label htmlFor="resume" className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
                  <Upload className="h-4 w-4 text-primary" />
                  Upload resume (PDF, DOC, DOCX, max 5MB)
                </label>
                <input
                  id="resume"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  {...register("resume")}
                  className="sr-only"
                />
                {errors.resume && <p className="mt-1 text-xs text-destructive">{errors.resume.message as string}</p>}
              </div>

              <div>
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" {...register("consent")} className="mt-1 h-4 w-4 rounded border-border" />
                  <span>I agree that Zyllo Tech may process my application data for recruitment purposes.</span>
                </label>
                {errors.consent && <p className="mt-1 text-xs text-destructive">{errors.consent.message}</p>}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? "Submitting..." : "Submit Application"}
              </button>
            </form>

            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Hiring team usually responds within 3-5 business days.
            </div>
          </div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default CareersPage;
