// Serialize an object for embedding inside a <script type="application/ld+json">
// tag. JSON.stringify alone is unsafe there: a "</script>" sequence inside any
// string value (e.g. a backend-sourced post or job title) closes the tag early
// and lets the remainder render as HTML — stored XSS. Escaping every "<"
// with the unicode JSON escape (backslash-u003c) keeps the parsed value
// identical while making early tag closure impossible.
// scripts/prerender.mjs applies the same escaping via its ldjson() helper.
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
