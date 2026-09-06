import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "@/lib/jsonld";

describe("serializeJsonLd", () => {
  it("emits no raw </ sequence for script-injection payloads", () => {
    const payload = { title: "</script><script>alert(1)</script>" };
    const out = serializeJsonLd(payload);
    expect(out).not.toContain("</");
    expect(out).not.toContain("<script");
  });

  it("escaping does not change the parsed value", () => {
    const payload = {
      title: "</script><script>alert(1)</script>",
      nested: { desc: "1 < 2 and <b>bold</b>" },
    };
    expect(JSON.parse(serializeJsonLd(payload))).toEqual(payload);
  });
});
