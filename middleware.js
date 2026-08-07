// This file is intentionally empty.
//
// Next.js 16 renamed middleware.js -> proxy.js (Node.js runtime).
// The active auth-refresh + /admin guard logic now lives in proxy.js
// at the project root. A leftover middleware.js is silently ignored by
// Next.js 16 (no build error), so this file must stay empty/unused —
// do not add exports here, or you'll have two competing, confusing
// "middleware" files.
//
// See: proxy.js
