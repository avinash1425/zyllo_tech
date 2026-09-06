import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import JobPostingJsonLd from "@/components/JobPostingJsonLd";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

function renderJsonLd(job: Record<string, unknown>) {
  const { container } = render(<JobPostingJsonLd job={job} />);
  const script = container.querySelector('script[type="application/ld+json"]');
  expect(script, "no ld+json script tag emitted").toBeTruthy();
  return JSON.parse(script!.innerHTML);
}

describe("JobPostingJsonLd", () => {
  it("floors validThrough ~30 days out for a 200-day-old posting", () => {
    const created = daysAgo(200);
    const data = renderJsonLd({ title: "Senior Engineer", created_at: created });
    const validThrough = new Date(data.validThrough).getTime();
    // created + 90d is ~110 days in the past; the emitted date must instead
    // be the ≥30-days-out floor, i.e. in the future.
    expect(validThrough).toBeGreaterThan(Date.now());
    expect(validThrough).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect(validThrough).toBeLessThan(Date.now() + 31 * DAY_MS);
  });

  it("uses created_at + 90 days for a fresh posting", () => {
    const created = daysAgo(1);
    const data = renderJsonLd({ title: "QA Engineer", created_at: created });
    const validThrough = new Date(data.validThrough).getTime();
    const expected = new Date(created);
    expected.setDate(expected.getDate() + 90);
    // Allow a couple hours of slack for DST shifts around setDate arithmetic.
    expect(Math.abs(validThrough - expected.getTime())).toBeLessThan(3 * 60 * 60 * 1000);
    expect(data.datePosted).toBe(created);
  });

  it('maps employment_type "part-time" to PART_TIME', () => {
    const data = renderJsonLd({
      title: "Designer",
      created_at: daysAgo(1),
      employment_type: "part-time",
    });
    expect(data.employmentType).toBe("PART_TIME");
  });

  it("falls back to FULL_TIME for unrecognized employment_type", () => {
    const data = renderJsonLd({
      title: "Designer",
      created_at: daysAgo(1),
      employment_type: "gig-economy-ninja",
    });
    expect(data.employmentType).toBe("FULL_TIME");
  });

  it("hiringOrganization logo is the square icon, not the wordmark", () => {
    const data = renderJsonLd({ title: "Engineer", created_at: daysAgo(1) });
    expect(data.hiringOrganization.logo.endsWith("/icon-512.png")).toBe(true);
  });
});
