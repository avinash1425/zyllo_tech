"use client";

import { useActionState, useRef, useState } from "react";
import Link from "@/lib/nx/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  FileSearch,
  Handshake,
  Loader2,
  Mail,
  MessageSquare,
  MessagesSquare,
  Phone,
  Send,
  User,
} from "lucide-react";
import { submitApplication } from "@/lib/api/applications";
import ResumeDropzone from "@/components/careers/ResumeDropzone";

const initialState = { status: "idle", message: "" };
const MAX_RESUME_BYTES = 5 * 1024 * 1024; // mirrors the server-side rule

// Client-side mirrors of the checks in submitApplication (which stays the
// source of truth); these only provide inline feedback before submitting.
function validateField(name, value) {
  switch (name) {
    case "fullName":
      return value.trim() ? "" : "Please enter your full name.";
    case "email":
      if (!value.trim()) return "Please enter your email address.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? "" : "Please enter a valid email address.";
    case "experienceYears": {
      if (value.trim() === "") return "Please enter your years of experience.";
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 && n <= 60 ? "" : "Enter a number between 0 and 60.";
    }
    default:
      return "";
  }
}

function validateFile(file) {
  if (!file || file.size === 0) return "Please attach your resume as a PDF.";
  if (file.type !== "application/pdf") return "Resume must be a PDF file.";
  if (file.size > MAX_RESUME_BYTES) return "Resume must be under 5 MB.";
  return "";
}

const inputBase =
  "peer min-h-14 w-full rounded-2xl border bg-white pb-2 pl-11 pr-4 pt-6 text-base text-[#1b2030] sm:text-[15px] placeholder-transparent shadow-[0_1px_2px_rgba(16,26,58,0.08)] outline-none transition-all duration-200 hover:border-[#1f4693]/30 focus:border-[#f7941e] focus:ring-4 focus:ring-[#f7941e]/15";

// Floating-label field: the <input>/<textarea> child must use `inputBase`
// (it is the `peer`) and carry placeholder=" " so the label can float.
function Field({ id, label, required, icon: Icon, error, hint, children }) {
  return (
    <div>
      <div className="relative">
        {children}
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-4 top-[1.0625rem] h-[1.125rem] w-[1.125rem] text-[#3089a6] transition-colors peer-focus:text-[#f96706]"
            aria-hidden="true"
          />
        )}
        <label
          htmlFor={id}
          className="pointer-events-none absolute left-11 top-[1.0625rem] origin-left text-sm text-[#676b7a] transition-all duration-200 peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-[#f96706] peer-[&:not(:placeholder-shown)]:top-2 peer-[&:not(:placeholder-shown)]:text-[11px] peer-[&:not(:placeholder-shown)]:font-semibold"
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-[#c2410c]" aria-hidden="true">
              *
            </span>
          ) : (
            <span className="ml-1 font-normal opacity-70">(optional)</span>
          )}
        </label>
      </div>
      {hint && !error && <p className="mt-1 text-[13px] text-[#4a5668]">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const NEXT_STEPS = [
  { icon: FileSearch, title: "Review", text: "Our team reviews your application and resume." },
  { icon: MessagesSquare, title: "Interview", text: "If your profile is a good fit, we will get in touch to talk further." },
  { icon: Handshake, title: "Offer", text: "Shortlisted candidates move on to a final decision." },
];

function SuccessState({ jobTitle, variant, onClose, onViewOthers }) {
  const reduce = useReducedMotion();
  const isModal = variant === "modal";

  const body = (
    <div className="relative flex flex-col items-center px-5 py-10 text-center sm:px-8">
      <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[#3089a6]/15 blur-3xl" />
      <motion.span
        initial={reduce ? false : { scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#16a34a] to-[#3089a6] shadow-xl shadow-[#16a34a]/25 ring-8 ring-[#3089a6]/10"
      >
        <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" aria-hidden="true">
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
          />
        </svg>
      </motion.span>

      <h3 className="relative mt-7 text-2xl font-bold tracking-tight text-[#1b2030]">
        We have received your application
      </h3>
      <p className="relative mt-2 max-w-md text-sm leading-relaxed text-[#676b7a]">
        Thank you for applying for the <span className="font-semibold text-[#1b2030]">{jobTitle}</span> role.
        Here is what happens next.
      </p>

      <ol className="relative mt-8 w-full max-w-md text-left">
        {NEXT_STEPS.map(({ icon: Icon, title, text }, i) => (
          <motion.li
            key={title}
            initial={reduce ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.35 + i * 0.12, duration: 0.4 }}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            {i < NEXT_STEPS.length - 1 && (
              <span aria-hidden="true" className="absolute left-[1.3125rem] top-11 h-[calc(100%-2.5rem)] w-0.5 bg-gradient-to-b from-[#3089a6]/50 to-[#f7941e]/30" />
            )}
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#1f4693] shadow-md ring-1 ring-[#e7e9ee]">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-bold text-[#1b2030]">
                <span className="mr-1.5 text-[#f96706]">{i + 1}.</span>
                {title}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-[#676b7a]">{text}</p>
            </div>
          </motion.li>
        ))}
      </ol>
      <p className="relative mt-6 text-xs text-[#676b7a]">Keep an eye on your inbox, including the spam folder.</p>
    </div>
  );

  const buttons = (
    <>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="inline-flex flex-1 items-center justify-center rounded-full border border-[#e7e9ee] bg-white px-6 py-3.5 text-sm font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20 sm:flex-none"
        >
          Close
        </button>
      )}
      {onViewOthers ? (
        <button
          type="button"
          onClick={onViewOthers}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#f7941e]/30 transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 sm:flex-none"
        >
          View other roles
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <Link
          href="/careers"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#f7941e]/30 transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 sm:flex-none"
        >
          View other roles
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </>
  );

  if (isModal) {
    return (
      <div role="status" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{body}</div>
        <div className="flex shrink-0 gap-3 border-t border-[#e7e9ee] bg-white/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:justify-end sm:px-8">
          {buttons}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="relative overflow-hidden rounded-3xl border border-[#e7e9ee] bg-white shadow-xl shadow-[#1f4693]/10"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]" />
      {body}
      <div className="flex gap-3 border-t border-[#e7e9ee] px-5 py-4 sm:justify-center sm:px-8">{buttons}</div>
    </div>
  );
}

// variant="card"  : standalone card (used on /careers/:id)
// variant="modal" : fills a popup - scrolling body + pinned footer actions
export default function ApplyForm({ jobId, jobTitle, variant = "card", onClose, onViewOthers }) {
  const [state, formAction, isPending] = useActionState(submitApplication, initialState);
  const [errors, setErrors] = useState({});
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const isModal = variant === "modal";

  if (state.status === "success") {
    return <SuccessState jobTitle={jobTitle} variant={variant} onClose={onClose} onViewOthers={onViewOthers} />;
  }

  function setError(name, message) {
    setErrors((prev) => ({ ...prev, [name]: message }));
  }

  function handleBlur(event) {
    const { name, value } = event.target;
    setError(name, validateField(name, value));
  }

  function handleInput(event) {
    const { name, value } = event.target;
    if (errors[name]) setError(name, validateField(name, value));
  }

  function handleFile(next) {
    setFile(next);
    setError("resume", next ? validateFile(next) : "");
  }

  function removeFile() {
    if (fileRef.current) fileRef.current.value = "";
    setFile(null);
    setError("resume", "");
  }

  // Only blocks the action when something is clearly invalid; the server
  // action re-validates everything regardless.
  function handleSubmit(event) {
    const data = new FormData(event.currentTarget);
    const next = {
      fullName: validateField("fullName", String(data.get("fullName") ?? "")),
      email: validateField("email", String(data.get("email") ?? "")),
      experienceYears: validateField("experienceYears", String(data.get("experienceYears") ?? "")),
      resume: validateFile(data.get("resume")),
    };
    setErrors(next);
    const firstBad = ["fullName", "email", "experienceYears", "resume"].find((k) => next[k]);
    if (firstBad) {
      event.preventDefault();
      event.currentTarget.querySelector(`#${firstBad}`)?.focus();
    }
  }

  const border = (name) => (errors[name] ? "border-red-400" : "border-[#d5d9e2]");

  const fields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field id="fullName" label="Full name" required icon={User} error={errors.fullName}>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          placeholder=" "
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={errors.fullName ? "fullName-error" : undefined}
          onBlur={handleBlur}
          onInput={handleInput}
          className={`${inputBase} ${border("fullName")}`}
        />
      </Field>

      <Field id="email" label="Email" required icon={Mail} error={errors.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder=" "
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "email-error" : undefined}
          onBlur={handleBlur}
          onInput={handleInput}
          className={`${inputBase} ${border("email")}`}
        />
      </Field>

      <Field id="phone" label="Phone number" icon={Phone}>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder=" "
          className={`${inputBase} border-[#d5d9e2]`}
        />
      </Field>

      <Field id="experienceYears" label="Years of experience" required icon={Briefcase} error={errors.experienceYears}>
        <input
          id="experienceYears"
          name="experienceYears"
          type="number"
          inputMode="numeric"
          min="0"
          max="60"
          step="1"
          required
          placeholder=" "
          aria-invalid={errors.experienceYears ? true : undefined}
          aria-describedby={errors.experienceYears ? "experienceYears-error" : undefined}
          onBlur={handleBlur}
          onInput={handleInput}
          className={`${inputBase} ${border("experienceYears")}`}
        />
      </Field>

      <div className="sm:col-span-2">
        <span className="mb-2 block text-sm font-semibold text-[#1b2030]">
          Resume (PDF)
          <span className="ml-0.5 text-[#c2410c]" aria-hidden="true">
            *
          </span>
        </span>
        <ResumeDropzone
          inputRef={fileRef}
          file={file}
          error={errors.resume}
          onChange={handleFile}
          onRemove={removeFile}
        />
      </div>

      <div className="sm:col-span-2">
        <Field id="coverNote" label="Why you're a good fit" icon={MessageSquare}>
          <textarea
            id="coverNote"
            name="coverNote"
            rows={4}
            placeholder=" "
            className={`${inputBase} resize-none border-[#d5d9e2]`}
          />
        </Field>
      </div>
    </div>
  );

  const errorBanner = state.status === "error" && (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {state.message}
    </div>
  );

  const submitButton = (
    <button
      type="submit"
      disabled={isPending}
      aria-busy={isPending}
      className="group/submit inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] via-[#f7941e] to-[#ffb15c] px-8 py-4 text-sm font-bold text-white shadow-lg shadow-[#f7941e]/30 transition-all duration-200 hover:shadow-xl hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
    >
      {isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Submitting...
        </>
      ) : (
        <>
          <Send className="h-4 w-4 transition-transform duration-200 group-hover/submit:translate-x-0.5 group-hover/submit:-translate-y-0.5" aria-hidden="true" />
          Submit Application
        </>
      )}
    </button>
  );

  if (isModal) {
    return (
      <form
        action={formAction}
        noValidate
        onSubmit={handleSubmit}
        onReset={() => setFile(null)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <input type="hidden" name="jobId" value={jobId} />
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-[#fafbfc] px-5 py-6 sm:px-8">
          <p className="text-[13px] text-[#4a5668]">
            Fields marked <span className="text-[#c2410c]">*</span> are required.
          </p>
          {fields}
          {errorBanner}
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-[#e7e9ee] bg-white/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_24px_-16px_rgba(16,26,58,0.18)] backdrop-blur sm:justify-end sm:px-8">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-full border border-[#e7e9ee] bg-white px-6 py-3.5 text-sm font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
            >
              Cancel
            </button>
          )}
          {submitButton}
        </div>
      </form>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#e7e9ee] bg-white p-6 shadow-[0_24px_48px_-20px_rgba(31,70,147,0.22)] sm:p-8">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]" />
      <h2 className="text-2xl font-bold tracking-tight text-[#1b2030]">Apply for this role</h2>
      <p className="mt-1 text-[13px] text-[#4a5668]">
        Fields marked <span className="text-[#c2410c]">*</span> are required.
      </p>

      <form
        action={formAction}
        noValidate
        onSubmit={handleSubmit}
        onReset={() => setFile(null)}
        className="mt-6 flex flex-col gap-5"
      >
        <input type="hidden" name="jobId" value={jobId} />
        {fields}
        {errorBanner}
        <div className="flex">{submitButton}</div>
      </form>
    </div>
  );
}
