"use client";

import { useActionState, useRef, useState } from "react";
import Link from "@/lib/nx/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Loader2,
  Mail,
  MessageSquare,
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
  "w-full rounded-xl border bg-white py-2.5 pl-10 pr-4 text-sm text-[#2b303b] placeholder:text-[#676b7a]/70 outline-none transition-all duration-200 focus:border-[#f7941e] focus:ring-4 focus:ring-[#f7941e]/15";

function Field({ id, label, required, icon: Icon, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-[#2b303b]">
        {label}
        {required ? (
          <span className="ml-0.5 text-[#c2410c]" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-[#676b7a]">(optional)</span>
        )}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-[#676b7a]"
            aria-hidden="true"
          />
        )}
        {children}
      </div>
      {hint && !error && <p className="mt-1 text-xs text-[#676b7a]">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function SuccessState({ jobTitle, variant, onClose, onViewOthers }) {
  const reduce = useReducedMotion();
  const isModal = variant === "modal";

  const body = (
    <div className="flex flex-col items-center px-5 py-10 text-center sm:px-8">
      <motion.span
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#16a34a] to-[#3089a6] shadow-lg shadow-[#16a34a]/30"
      >
        <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" aria-hidden="true">
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="#fff"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.15, duration: 0.45, ease: "easeOut" }}
          />
        </svg>
      </motion.span>

      <h3 className="mt-6 text-xl font-bold text-[#2b303b] sm:text-2xl">
        We have received your application
      </h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-[#676b7a]">
        Thank you for applying for the <span className="font-semibold text-[#2b303b]">{jobTitle}</span>{" "}
        role.
      </p>

      <ol className="mt-6 w-full max-w-md space-y-3 text-left text-sm text-[#676b7a]">
        {[
          "Our team reviews every application and your resume.",
          "If your profile is a good fit, we will reach out by email or phone.",
          "Keep an eye on your inbox, including the spam folder.",
        ].map((step, i) => (
          <li key={step} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1f4693]/10 text-xs font-bold text-[#1f4693]">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );

  const buttons = (
    <>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="inline-flex flex-1 items-center justify-center rounded-full border border-[#e7e9ee] bg-white px-6 py-3 text-sm font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20 sm:flex-none"
        >
          Close
        </button>
      )}
      {onViewOthers ? (
        <button
          type="button"
          onClick={onViewOthers}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#f7941e] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#f7941e]/30 transition-colors hover:bg-[#db7d17] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 sm:flex-none"
        >
          View other roles
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <Link
          href="/careers"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#f7941e] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#f7941e]/30 transition-colors hover:bg-[#db7d17] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 sm:flex-none"
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
        <div className="flex shrink-0 gap-3 border-t border-[#e7e9ee] bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-8">
          {buttons}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-lg shadow-[#1f4693]/5"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]"
      />
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

  const fields = (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field id="fullName" label="Full name" required icon={User} error={errors.fullName}>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          placeholder="Your full name"
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={errors.fullName ? "fullName-error" : undefined}
          onBlur={handleBlur}
          onInput={handleInput}
          className={`${inputBase} ${errors.fullName ? "border-red-400" : "border-[#d5d9e2]"}`}
        />
      </Field>

      <Field id="email" label="Email" required icon={Mail} error={errors.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "email-error" : undefined}
          onBlur={handleBlur}
          onInput={handleInput}
          className={`${inputBase} ${errors.email ? "border-red-400" : "border-[#d5d9e2]"}`}
        />
      </Field>

      <Field id="phone" label="Phone number" icon={Phone}>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+91 00000 00000"
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
          placeholder="e.g. 4"
          aria-invalid={errors.experienceYears ? true : undefined}
          aria-describedby={errors.experienceYears ? "experienceYears-error" : undefined}
          onBlur={handleBlur}
          onInput={handleInput}
          className={`${inputBase} ${errors.experienceYears ? "border-red-400" : "border-[#d5d9e2]"}`}
        />
      </Field>

      <div className="sm:col-span-2">
        <span className="mb-1.5 block text-sm font-semibold text-[#2b303b]">
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
            placeholder="Tell us a bit about your experience and why this role interests you..."
            className={`${inputBase} resize-none border-[#d5d9e2]`}
          />
        </Field>
      </div>
    </div>
  );

  const errorBanner = state.status === "error" && (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
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
      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#f7941e] px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#f7941e]/30 transition-all duration-200 hover:bg-[#db7d17] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
    >
      {isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Submitting...
        </>
      ) : (
        <>
          <Send className="h-4 w-4" aria-hidden="true" />
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
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8">
          <p className="text-xs text-[#676b7a]">
            Fields marked <span className="text-[#c2410c]">*</span> are required.
          </p>
          {fields}
          {errorBanner}
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-[#e7e9ee] bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-8">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-full border border-[#e7e9ee] bg-white px-5 py-3 text-sm font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
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
    <div className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-lg shadow-[#1f4693]/5 sm:p-8">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]"
      />
      <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">Apply for this role</h2>
      <p className="mt-1 text-xs text-[#676b7a]">
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
