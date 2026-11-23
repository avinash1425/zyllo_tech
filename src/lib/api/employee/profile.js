// Employee Portal: My Profile (migration 231).
// Work details are read-only here (set by the company). Personal details and
// emergency contacts are saved through RPCs that the database validates again.
import { supabase } from "@/lib/supabase/client";

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v }));
export const MARITAL_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
export const EMPLOYMENT_TYPES = { full_time: "Full-time", part_time: "Part-time", intern: "Intern", contract: "Contract" };

export const PERSONAL_FIELDS = [
  "date_of_birth",
  "gender",
  "blood_group",
  "marital_status",
  "nationality",
  "personal_email",
  "phone",
  "alternate_phone",
  "current_address",
  "permanent_address",
];

const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Same rules as the database CHECKs, so the user sees a clear message first. */
export function validatePersonal(form) {
  const errors = {};
  const v = (k) => String(form[k] ?? "").trim();
  if (v("date_of_birth")) {
    const dob = new Date(`${v("date_of_birth")}T00:00:00`);
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() - 14);
    if (Number.isNaN(dob.getTime()) || dob < new Date("1920-01-01T00:00:00") || dob > limit) {
      errors.date_of_birth = "Enter a valid date of birth (at least 14 years ago).";
    }
  }
  if (v("personal_email") && (!EMAIL.test(v("personal_email")) || v("personal_email").length > 254)) {
    errors.personal_email = "Enter a valid email address.";
  }
  for (const k of ["phone", "alternate_phone"]) {
    if (v(k) && !PHONE.test(v(k))) errors[k] = "Use 7–20 digits; +, spaces, ( ) and - are allowed.";
  }
  if (v("nationality").length > 60) errors.nationality = "Keep it under 60 characters.";
  for (const k of ["current_address", "permanent_address"]) {
    if (v(k).length > 500) errors[k] = "Keep it under 500 characters.";
  }
  return errors;
}

export function validateContacts(list) {
  const errors = list.map((c) => {
    const e = {};
    if (!String(c.name ?? "").trim()) e.name = "Name is required.";
    else if (c.name.trim().length > 120) e.name = "Keep it under 120 characters.";
    if (!String(c.relationship ?? "").trim()) e.relationship = "Relationship is required.";
    else if (c.relationship.trim().length > 40) e.relationship = "Keep it under 40 characters.";
    if (!String(c.phone ?? "").trim()) e.phone = "Phone is required.";
    else if (!PHONE.test(c.phone.trim())) e.phone = "Use 7–20 digits; +, spaces, ( ) and - are allowed.";
    if (String(c.alternate_phone ?? "").trim() && !PHONE.test(c.alternate_phone.trim())) {
      e.alternate_phone = "Use 7–20 digits; +, spaces, ( ) and - are allowed.";
    }
    return e;
  });
  return errors.some((e) => Object.keys(e).length) ? errors : null;
}

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  if (/Add 1 to 3 emergency contacts|Not an active employee/i.test(msg)) return msg;
  if (/dob_range/.test(msg)) return "Enter a valid date of birth (at least 14 years ago).";
  if (/phone/.test(msg)) return "Check the phone numbers.";
  if (/personal_email/.test(msg)) return "Check the email address.";
  return fallback;
}

export async function getMyProfile() {
  const { data, error } = await supabase.rpc("ep_my_profile");
  if (error) throw error;
  return data;
}

export async function updateMyPersonal(form) {
  const p = Object.fromEntries(PERSONAL_FIELDS.map((k) => [k, String(form[k] ?? "").trim()]));
  const { data, error } = await supabase.rpc("ep_update_my_profile", { p });
  if (error) return { ok: false, message: friendly(error, "Could not save your details. Please try again.") };
  return { ok: true, profile: data };
}

export async function saveMyEmergencyContacts(list) {
  const p = list.map((c) => ({
    name: c.name.trim(),
    relationship: c.relationship.trim(),
    phone: c.phone.trim(),
    alternate_phone: String(c.alternate_phone ?? "").trim(),
  }));
  const { data, error } = await supabase.rpc("ep_save_my_emergency_contacts", { p });
  if (error) return { ok: false, message: friendly(error, "Could not save emergency contacts. Please try again.") };
  return { ok: true, profile: data };
}
