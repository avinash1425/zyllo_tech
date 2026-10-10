// Countries where Zyllo Tech offers its services remotely. These are markets
// served from the single office in Guntur, India: never office locations,
// local staff, customers or partnerships. Used by the remote-delivery
// section, the international FAQ and the Organization structured data.
// Keep in sync with the static JSON-LD copy in index.html.
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

// One-sentence version for pages that do not show the full list.
export const SERVICE_AREA_SUMMARY =
  "Our services are available remotely to businesses in India, the United States, the United Kingdom, the Middle East and Southeast Asia, and we welcome enquiries from other countries.";

// Shown on /services and mirrored in its FAQPage structured data. Every
// answer restates something the site already says elsewhere.
export const INTERNATIONAL_FAQS = [
  {
    q: "Which countries does Zyllo Tech work with?",
    a: "Our services are available remotely to businesses in India, the United States, the United Kingdom and Canada, in the Middle East and North Africa (the United Arab Emirates, Saudi Arabia, Qatar, Oman, Kuwait, Bahrain and Egypt), and in Asia-Pacific (Singapore, Malaysia and Australia). Enquiries from other countries are welcome.",
  },
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
