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
  },
  {
    title: "AI/ML Engineer",
    location: "India / Remote",
    type: "Full Time",
    experience: "3+ Years",
    skills: ["Python", "TensorFlow", "PyTorch", "NLP", "MLOps"],
  },
  {
    title: "DevOps Engineer",
    location: "India / Remote",
    type: "Full Time",
    experience: "4+ Years",
    skills: ["Docker", "Kubernetes", "CI/CD", "AWS", "Terraform"],
  },
  {
    title: "UI/UX Designer",
    location: "India / Remote",
    type: "Full Time",
    experience: "3+ Years",
    skills: ["Figma", "Design Systems", "Prototyping", "User Research"],
  },
];

const acceptedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const acceptedFileExtensions = [".pdf", ".doc", ".docx"];
const maxResumeSize = 5 * 1024 * 1024;

const isSupportedResume = (file: File) => {
  const byMime = acceptedMimeTypes.includes(file.type);
  const byExtension = acceptedFileExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  );
  return byMime || byExtension;
};

const careerFormSchema = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name."),
  email: z.string().trim().email("Please enter a valid email address."),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[-()\d\s]{8,20}$/, "Please enter a valid phone number."),
  role: z.string().trim().min(2, "Please select a role."),
  location: z.string().trim().min(2, "Please enter your current location."),
  experience: z.string().trim().min(1, "Please enter your experience."),
  linkedIn: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (val) => !val || /^https?:\/\/.+/i.test(val),
      "LinkedIn URL should start with http:// or https://",
    ),
  coverLetter: z
    .string()
    .trim()
    .min(40, "Please add at least 40 characters.")
    .max(1200, "Cover letter must be 1200 characters or less."),
  resume: z
    .custom<FileList>((files) => files instanceof FileList, "Please upload your resume.")
    .refine((files) => files.length === 1, "Please upload one resume file.")
    .refine((files) => files[0].size <= maxResumeSize, "Resume must be 5MB or smaller.")
    .refine((files) => isSupportedResume(files[0]), "Upload PDF, DOC, or DOCX only."),
  consent: z.literal(true, {
    errorMap: () => ({ message: "Please confirm the data consent checkbox." }),
  }),
});

type CareerFormData = z.infer<typeof careerFormSchema>;

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
      const fileExt = file.name.split(".").pop();
      const filePath = `${crypto.randomUUID()}.${fileExt}`;
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

      reset();
      toast({
        title: "Application submitted",
        description: "Our recruitment team will review your profile and contact you soon.",
      });
    } catch (err: any) {
      toast({
        title: "Submission failed",
        description: err?.message || "Something went wrong. Please try again.",
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
            <h3 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">Current opportunities</h3>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {openings.map((job, i) => (
              <motion.article
                key={job.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="rounded-2xl border border-border bg-background p-6 shadow-sm"
              >
                <h4 className="font-display text-xl font-semibold text-foreground">{job.title}</h4>
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-primary" />{job.location}</span>
                  <span className="inline-flex items-center gap-1.5"><Briefcase className="h-4 w-4 text-primary" />{job.type}</span>
                  <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4 text-primary" />{job.experience}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {job.skills.map((skill) => (
                    <span key={skill} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {skill}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => applyForRole(job.title)}
                  className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80"
                >
                  Apply for this role <ArrowRight className="h-4 w-4" />
                </button>
              </motion.article>
            ))}
          </div>
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
