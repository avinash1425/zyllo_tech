// Countries where Zyllo Tech offers its services remotely. These are markets
// served from the single office in Guntur, India: never office locations,
// local staff, customers or partnerships. They are targeting signals only
// and are not listed in the visible pages: they feed the Organization
// structured data. Keep in sync with the static JSON-LD and noscript copy
// in index.html and with public/llms.txt.
export const SERVICE_REGIONS = [
  {
    name: "Middle East & North Africa",
    countries: [
      "United Arab Emirates",
      "Saudi Arabia",
      "Qatar",
      "Oman",
      "Kuwait",
      "Bahrain",
      "Egypt",
    ],
  },
  {
    name: "Asia-Pacific",
    countries: ["India", "Singapore", "Malaysia", "Australia"],
  },
  {
    name: "North America & Europe",
    countries: ["United States", "United Kingdom", "Canada"],
  },
];

export const SERVICE_COUNTRIES = SERVICE_REGIONS.flatMap((region) => region.countries);

// Visible one-sentence version. Names no countries on purpose.
export const SERVICE_AREA_SUMMARY =
  "Our services are available remotely to businesses in India and around the world, and we welcome enquiries from any country.";

// Shown on /services and mirrored in its FAQPage structured data, which
// must match the visible answers. Every answer restates something the site
// already says elsewhere.
export const INTERNATIONAL_FAQS = [
  {
    q: "Does Zyllo Tech have offices outside India?",
    a: "No. Our whole team works from one office in Guntur, Andhra Pradesh, India. We do not have offices or local staff in other countries, and every project is delivered remotely.",
  },
  {
    q: "Can a company outside India outsource software development to Zyllo Tech?",
    a: "Yes. Companies outsource complete projects or ongoing work to us, including custom software, web and mobile apps, AI solutions, cloud, QA and maintenance. This is often called offshore software development. You can work with us on a fixed scope, on time and materials, or with a dedicated team.",
  },
  {
    q: "How does a remote software project with a team in India work?",
    a: "Tell us what you want to build and we reply within one business day with clear next steps. From there the project runs over video calls, shared boards and written updates, so you can follow progress from wherever you are.",
  },
];
