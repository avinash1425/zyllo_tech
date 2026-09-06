import { SITE_URL, LEGAL_NAME } from "@/lib/site-config";
import { serializeJsonLd } from "@/lib/jsonld";

// schema.org JobPosting requires employmentType from a fixed enum, but
// employment_type in job_postings is a free-text admin field (see
// admin/careers/CareersManager.js — plain <input type="text">). Map the
// common values an admin would actually type; anything unrecognized falls
// back to FULL_TIME rather than emitting an invalid enum value.
const EMPLOYMENT_TYPE_MAP = {
  "full-time": "FULL_TIME",
  fulltime: "FULL_TIME",
  "part-time": "PART_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACTOR",
  contractor: "CONTRACTOR",
  intern: "INTERN",
  internship: "INTERN",
  temporary: "TEMPORARY",
  temp: "TEMPORARY",
  volunteer: "VOLUNTEER",
  "per diem": "PER_DIEM",
};

function toSchemaEmploymentType(raw) {
  const key = (raw || "").trim().toLowerCase();
  return EMPLOYMENT_TYPE_MAP[key] || "FULL_TIME";
}

// Google for Jobs requires a validThrough date or treats the posting as
// stale after ~30 days. job_postings has no explicit expiry column, so
// this uses a 90-day window from created_at — but never earlier than 30
// days from now: this component only renders for postings that are still
// open, and a validThrough in the past makes Google drop the posting from
// the jobs surface (and flag it in Search Console) while it is genuinely
// still accepting applicants.
function getValidThrough(createdAt) {
  const posted = createdAt ? new Date(createdAt) : new Date();
  const validThrough = new Date(posted);
  validThrough.setDate(validThrough.getDate() + 90);
  const floor = new Date();
  floor.setDate(floor.getDate() + 30);
  return (validThrough > floor ? validThrough : floor).toISOString();
}

export default function JobPostingJsonLd({ job }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description || `${job.title} at ${LEGAL_NAME}.`,
    datePosted: job.created_at || undefined,
    validThrough: getValidThrough(job.created_at),
    employmentType: toSchemaEmploymentType(job.employment_type),
    hiringOrganization: {
      "@type": "Organization",
      name: LEGAL_NAME,
      sameAs: SITE_URL,
      // Google wants a roughly square logo ≥112×112 here — not the 5:1
      // wordmark banner used for OG images.
      logo: `${SITE_URL}/icon-512.png`,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location || undefined,
        addressCountry: "IN",
      },
    },
    directApply: true,
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
