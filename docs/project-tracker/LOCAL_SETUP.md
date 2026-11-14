# Project Tracker — run the website and Project Tracker locally

Branch: `project-tracker` (repository `avinash1425/zyllo_tech`). It contains the complete Zyllo Tech website
(public pages, admin dashboard, login, SEO / GA4 / Search Console integration) plus the Project Tracker module.

## Important

* **The Project Tracker database is not in Git.** Every developer runs a private, throwaway local database
  (synthetic demo data, recreated on each start). Nothing you enter locally is shared through GitHub, and
  nothing is sent to any Supabase project.
* **Plain `npm run dev` uses the committed `.env`, which points at the LIVE production Supabase project**
  (public pages and the real admin login). Use the local harness below for Project Tracker work. The Project
  Tracker SQL (`supabase/project-tracker/`) is **not** installed on live; on live, Project Tracker shows
  "not installed on this backend yet".
* Never commit `.env.local`, `.env.*.local`, passwords, service-role keys or database dumps.

## Requirements

* Git, Node.js 20+ (tested with Node 24) and npm.
* PostgreSQL **17** server binaries (`initdb`, `postgres`, `psql`; no extensions needed).
  Windows: the EDB installer (default path `C:\Program Files\PostgreSQL\17\bin` is found automatically).
  macOS/Linux: install PostgreSQL 17 and set `PG_BIN` to the folder that contains `initdb` if it is not found.
* Google Chrome — only for the automated browser tests.

## Clone and start

```bash
git clone --branch project-tracker --single-branch https://github.com/avinash1425/zyllo_tech.git zyllo-project-tracker
cd zyllo-project-tracker
npm ci
node scripts/pt-local/start.mjs          # keep this terminal open; Ctrl+C stops and deletes the local database
```

Open **http://127.0.0.1:8093/login** and sign in with a synthetic account (password `Local-Test-Only-2026!`,
local test use only):

| Account | Role |
|---|---|
| `pt.manager@example.test` | website admin, Project Tracker Manager |
| `pt.editor@example.test` | website admin, Editor |
| `pt.viewer@example.test` | website admin, Viewer |
| `zyllo.admin.sim@example.test` | simulated stand-in for the existing admin, Manager via 010/011 |
| `pt.blocked@example.test` / `not.admin@example.test` | access-denied checks |

Then: Admin → **Project Overview** (Project Tracker) → Companies → Company A1 → projects.

Stop from another terminal with `node scripts/pt-local/stop.mjs`. Ports: web 8093, local API 54331
(override with `--port-web` / `--port-api`; 8080 is reserved for the normal dev server).

Options: `--no-seed` (empty database), `--vault-test-double` (plaintext stand-in vault to exercise the password
UI — NOT encrypted, test only), `--new-jwt-secret` (rotate the local signing secret).

## Tests

```bash
npm test                                          # unit tests
node scripts/pt-local/db-test.mjs                 # database: RLS, roles, workflows, rollback (own temp cluster)
node scripts/pt-local/start.mjs                   # in one terminal, then in another:
node scripts/pt-local/browser-flows.mjs           # full UI workflows (headless Chrome, local only)
node scripts/pt-local/browser-flows.mjs --auth main
node scripts/pt-local/browser-flows.mjs --admin-sim
npx vite build                                    # production build
```

Lint: the committed `eslint.config.mjs` still references `eslint-config-next` (left over from the Next.js
version, also on `lovable-port`), so `npm run lint` fails before linting. This is pre-existing and not changed here.

## Optional: sign in with a real account from the HRMS dev project

`node scripts/pt-local/start.mjs --auth-upstream hr-dev` forwards sign-in (only) for non-synthetic emails to the
HRMS dev Supabase project; data stays local. It needs a git-ignored `.env.hr.local` with that project's public URL and
publishable key (ask the project owner; never commit it). See `supabase/project-tracker/README.md`.

## Going live (not done; needs the owner's approval)

`supabase/project-tracker/README.md` lists the SQL files (000 preflight … 011 manager assignment), the approval
gates and rollbacks. Nothing in this branch deploys or publishes anything by itself.
