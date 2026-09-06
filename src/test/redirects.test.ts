import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Text-level cross-check: every legacy path in the prerender REDIRECTS map
// must also have a client-side <Route><Navigate> in App.tsx pointing at the
// same target, so crawler stubs and the SPA agree on where old URLs go.

const root = resolve(__dirname, "..", "..");
const prerenderSrc = readFileSync(resolve(root, "scripts/prerender.mjs"), "utf8");
const appSrc = readFileSync(resolve(root, "src/App.tsx"), "utf8");

function parsePrerenderRedirects(): Record<string, string> {
  const block = prerenderSrc.match(/const REDIRECTS\s*=\s*\{([\s\S]*?)\}/);
  expect(block, "REDIRECTS map not found in scripts/prerender.mjs").toBeTruthy();
  const map: Record<string, string> = {};
  for (const m of block![1].matchAll(/["'](\/[^"']*)["']\s*:\s*["'](\/[^"']*)["']/g)) {
    map[m[1]] = m[2];
  }
  return map;
}

function parseAppRedirects(): Record<string, string> {
  const map: Record<string, string> = {};
  const routeRe =
    /<Route\s+path=["'](\/[^"']*)["']\s+element=\{\s*<Navigate\s+to=["'](\/[^"']*)["']/g;
  for (const m of appSrc.matchAll(routeRe)) {
    map[m[1]] = m[2];
  }
  return map;
}

describe("legacy redirects", () => {
  const prerenderRedirects = parsePrerenderRedirects();
  const appRedirects = parseAppRedirects();

  it("prerender REDIRECTS map is non-empty", () => {
    expect(Object.keys(prerenderRedirects).length).toBeGreaterThanOrEqual(6);
  });

  it("every prerender redirect has a matching <Navigate> route in App.tsx", () => {
    for (const [from, to] of Object.entries(prerenderRedirects)) {
      expect(
        appRedirects[from],
        `App.tsx has no <Route path="${from}"> with a <Navigate> (prerender sends it to ${to})`,
      ).toBe(to);
    }
  });
});
