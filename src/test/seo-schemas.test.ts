import { describe, expect, it } from "vitest";
import {
  SITE_URL,
  organizationSchema,
  webSiteSchema,
  breadcrumbSchema,
  serviceSchema,
} from "@/components/SEOHead";
import { SERVICES } from "@/data/services";

describe("organizationSchema", () => {
  it("has the required Organization fields", () => {
    expect(organizationSchema.name).toBe("Zyllo Tech");
    expect(organizationSchema.url).toBe("https://zyllotech.com");
    expect(organizationSchema.logo).toBeTruthy();
    expect(organizationSchema.logo.url).toBe("https://zyllotech.com/zyllo-logo.png");
  });

  it("declares logo dimensions in the 5:1 wordmark ratio", () => {
    const { width, height } = organizationSchema.logo;
    expect(typeof width).toBe("number");
    expect(typeof height).toBe("number");
    expect(width / height).toBe(5);
  });

  it("has the exact legal name", () => {
    expect(organizationSchema.legalName).toBe(
      "Zyllo Tech Software Solutions Private Limited",
    );
  });

  it("every hasOfferCatalog offer URL is a real https service page", () => {
    const serviceSlugs = new Set(SERVICES.map((s: { slug: string }) => s.slug));
    const offers = organizationSchema.hasOfferCatalog.itemListElement;
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      for (const url of [offer.url, offer.itemOffered?.url]) {
        expect(
          url?.startsWith("https://zyllotech.com/services/"),
          `offer url ${url} does not use the https service prefix`,
        ).toBe(true);
        const slug = (url as string).slice("https://zyllotech.com/services/".length);
        expect(serviceSlugs.has(slug), `offer url slug ${slug} not in services.js`).toBe(true);
      }
    }
  });
});

describe("webSiteSchema", () => {
  it("SearchAction urlTemplate targets the blog search", () => {
    expect(webSiteSchema.potentialAction.target.urlTemplate).toContain("/blog?q=");
    expect(webSiteSchema.potentialAction.target.urlTemplate).toContain("{search_term_string}");
  });
});

describe("breadcrumbSchema", () => {
  it("builds correct ListItem positions in order", () => {
    const items = [
      { name: "Home", url: `${SITE_URL}` },
      { name: "Services", url: `${SITE_URL}/services` },
      { name: "Web Development", url: `${SITE_URL}/services/web-development` },
    ];
    const schema = breadcrumbSchema(items);
    expect(schema["@type"]).toBe("BreadcrumbList");
    expect(schema.itemListElement).toHaveLength(3);
    schema.itemListElement.forEach((li, i) => {
      expect(li["@type"]).toBe("ListItem");
      expect(li.position).toBe(i + 1);
      expect(li.name).toBe(items[i].name);
      expect(li.item).toBe(items[i].url);
    });
  });
});

describe("serviceSchema", () => {
  it("output has provider @id pointing at the organization node", () => {
    const schema = serviceSchema({
      name: "Web Development",
      description: "Fast, secure web apps.",
      url: `${SITE_URL}/services/web-development`,
    });
    expect(schema["@type"]).toBe("Service");
    expect(schema.provider).toEqual({ "@id": `${SITE_URL}/#organization` });
    // The @id must resolve to the actual organizationSchema node.
    expect(organizationSchema["@id"]).toBe(schema.provider["@id"]);
  });
});
