// Single source of truth for company contact details shown on /contact.
// (Values are the ones already used across the site.)
export const CONTACT_INFO = {
  legalName: "Zyllo Tech Software Solutions Private Limited",
  addressLines: [
    "R V Plaza, Door No. 134-77/1, 3rd Floor,",
    "Gayathri Nagar, Phase-2,",
    "Mahatma Gandhi Inner Ring Road,",
    "Guntur - 522034, Andhra Pradesh, India.",
  ],
  mapQuery: "R V Plaza, Gayathri Nagar Phase-2, Mahatma Gandhi Inner Ring Road, Guntur 522034, Andhra Pradesh",
  email: "info@zyllotech.com",
  phoneDisplay: "+91 70757 73680",
  phoneHref: "tel:+917075773680",
  whatsappHref: "https://wa.me/917075773680",
  websiteLabel: "www.zyllotech.com",
  websiteHref: "https://www.zyllotech.com",
};

const q = encodeURIComponent(CONTACT_INFO.mapQuery);
export const DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
export const MAP_OPEN_URL = `https://www.google.com/maps/search/?api=1&query=${q}`;
export const MAP_EMBED_URL = `https://www.google.com/maps?q=${q}&output=embed`;
