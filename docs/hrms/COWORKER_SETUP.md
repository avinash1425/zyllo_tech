# Coworker setup: run the HRMS against the shared HR development project

This guide gets the Zyllo Tech website, HR Operations (`/hr`) and the Employee Portal (`/employee`) running on your own Windows computer, connected to the **shared HR development Supabase project** (`whiclllqgxxqhufkduuo`).

You will see the **same HR development records** as the rest of the team, and you sign in with **existing accounts**. You don't create users or reset passwords.

> **Two ways to run the HRMS. Pick the right one:**
> - **Shared HR development** (this guide). The real app talks to the hosted HR dev project. The data is shared and changes are visible to everyone at once.
> - **Offline synthetic testing** ([`RUN_LOCALLY.md`](RUN_LOCALLY.md)). A throwaway local database with fictional people. Nothing is shared and nothing persists. Use it for experiments and automated tests.

**Never production.** The committed `.env` file points at the **live website's** Supabase project (that's what Lovable publishes). That's why you must **not** use `npm run dev` for HR work. Always start with `node scripts/hr-dev/start.mjs`. It refuses to run unless it's configured for HR development, then checks what the browser actually received.

---

## 1. What you need first

| Item | Where it comes from |
|---|---|
| Windows 10/11, **Node.js 22 or 24 LTS** (20.19+ minimum) and **Git** | https://nodejs.org and https://git-scm.com |
| The HR dev **publishable key** (`sb_publishable_…`) | Shared with you privately (see §9) |
| Passwords for the accounts you'll use | Shared with you privately, one per account |
| (Optional) Supabase organisation invite | Only if you will run SQL, apply migrations or deploy functions |

You **don't** need a GitHub account to clone; the repository is public. To push changes you must be added as a collaborator.

> Because the repository is public, **nothing secret may ever be committed**: no keys, passwords or database URLs. `.env.hr-dev.local` is git-ignored for this reason.

## 2. Clone and install
Open **PowerShell** (or Git Bash):

```powershell
git clone --branch feature/zyllo-hrms-employee-portal https://github.com/avinash1425/zyllo_tech.git
cd zyllo_tech
npm ci
```
`npm ci` installs exactly the versions in `package-lock.json`. It takes a few minutes the first time.

## 3. Configure the HR development connection

```powershell
Copy-Item .env.hr-dev.example .env.hr-dev.local
notepad .env.hr-dev.local
```
Replace `sb_publishable_REPLACE_ME` with the publishable key you were given. Leave the other two lines as they are:

| Variable | Value | Secret? |
|---|---|---|
| `HR_DEV_PROJECT_REF` | `whiclllqgxxqhufkduuo` | no |
| `VITE_SUPABASE_URL` | `https://whiclllqgxxqhufkduuo.supabase.co` | no |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | low (it's built into every browser page), but share it privately anyway |

**Never put any of these in this file:** a secret or service-role key (`sb_secret_…`), a database URL or any password. The launcher refuses secret keys in browser variables. Secret keys live only inside Supabase, where the Edge Functions use them.

Check the configuration without starting anything:
```powershell
node scripts/hr-dev/start.mjs --check
```
Expected:
```
[hr-dev] Supabase project : HR development whiclllqgxxqhufkduuo
[hr-dev] Supabase URL     : https://whiclllqgxxqhufkduuo.supabase.co
[hr-dev] Publishable key  : sb_publishable_…(46 chars)
[hr-dev] App URL          : http://127.0.0.1:8080/login
[hr-dev] Configuration OK (--check: not starting).
```

## 4. Start the app

```powershell
node scripts/hr-dev/start.mjs
```
Wait for:
```
[hr-dev] Verified: the browser talks to HR development only. Open http://127.0.0.1:8080/login  (Ctrl+C to stop)
```
Then open **http://127.0.0.1:8080/login**. Stop with **Ctrl+C**.

- **Port:** the app uses port **8080** because the HR Edge Functions accept requests from `http://127.0.0.1:8080` (or `:3000`) by default. If 8080 is busy, use `node scripts/hr-dev/start.mjs --port 3000`. Other ports work for everything **except** the two Edge Functions (Employee ID login management and Change password).
- **Address:** use `127.0.0.1`, not `localhost`. The launcher binds to `127.0.0.1`, and sessions are stored per address.

## 5. Sign in and check each role

There is **one sign-in page, `/login`**, for everyone. The field accepts an **email address or an Employee ID**.

**Use a separate browser session for each role**, for example a normal window, an InPrivate/Incognito window and a second browser profile. A sign-in is stored per browser profile, so two roles in the same profile replace each other.

| Role | Sign in with | Expected landing page | What decides it |
|---|---|---|---|
| Website Admin | `info@zyllotech.com` | **`/admin`** | listed in `admin_users` (`public.is_admin()`), no HR role |
| HR Admin | `hradmin@zyllotech.com` | **`/hr`** (HR Dashboard) | HR role `super_admin` grants the HR dashboard permissions |
| Employee | `ZT-0001` (Employee ID, no email) | **`/employee`** (Employee Portal) | Employee ID login linked to employee ZT-0001, portal access on |

How the sign-in page routes you (`src/hr/platform/account.js`):
1. An Employee ID such as `ZT-0001` becomes the internal, never-mailed sign-in address `zt-0001@staff.zyllotech.com`. Anything with an `@` is used unchanged.
2. After sign-in: HR permissions go to `/hr`; otherwise an employee profile goes to `/employee`; otherwise a website admin goes to `/admin`; otherwise you see "No portal access yet".
3. An Employee ID account with a temporary or expired password goes to `/employee/set-password` first.
4. The old addresses `/hr/login` and `/employee/login` redirect to `/login`.

**Verification checklist (read-only, safe on shared data):**
- [ ] Website Admin lands on `/admin`, and the dashboard opens.
- [ ] HR Admin lands on `/hr`; Employees opens and lists the same employees your colleague sees.
- [ ] `ZT-0001` lands on `/employee`; the account menu shows **"Employee ID ZT-0001"** (never the internal address).
- [ ] Signing out returns to `/login` and only ends **that** browser's session.

**Do not use these on shared accounts unless the account owner agrees:**
- **Change password.** It signs out the other person, who then needs the new password.
- **HR → Employee → Login & Access (create, reset, deactivate).** These change a real login. A reset gives the employee a new temporary password.

These two features use the HR development Edge Functions `hr-employee-login` and `hr-change-my-password`, which were deployed to HR development on 2026-11-07 (see [`EDGE_FUNCTION_DEPLOYMENT.md`](EDGE_FUNCTION_DEPLOYMENT.md)). Signing in, including with an Employee ID, doesn't depend on them.

**Tip for one browser profile:** sessions are stored per address, so you can keep three roles signed in side by side on `http://127.0.0.1:8080`, `http://localhost:8080` and `http://127.0.0.1:3000` (a second launcher with `--port 3000`). All three are accepted by the Edge Functions.

## 6. How the data is shared

There is nothing to copy or sync. Both computers talk to the **same hosted database** (`whiclllqgxxqhufkduuo`), so:
- you see the same employees, attendance, leave, payroll and so on, filtered by your account's permissions (Row Level Security);
- anything you create, approve or delete is visible to everyone **immediately**, and can't be undone by "restarting";
- the HR dev project's audit log records the **account**, not the person or computer. When two people share an account, agree who does what.

For experiments, destructive tests or automated test runs, use the offline harness in [`RUN_LOCALLY.md`](RUN_LOCALLY.md) instead.

## 7. Access and permissions you need

| Access | Needed for | How |
|---|---|---|
| Clone the repository | everything | public, no access needed |
| Push branches | contributing code | owner adds you as a GitHub collaborator on `avinash1425/zyllo_tech` |
| HR dev publishable key | running the app | shared privately |
| Account passwords | signing in | shared privately, per account |
| Supabase organisation member | SQL editor, logs, migrations, deploying functions | owner invites you in the Supabase dashboard (not needed just to run the app) |
| HR dev database URL | applying migrations (`scripts/hr-db-apply.mjs`) | maintainers only; shared privately, kept in `.env.hr-dev.local` without a `VITE_` prefix |

You never need, and should never receive, the **production** project's keys or database password.

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `REFUSING TO START: Configuration file not found` | Create `.env.hr-dev.local` from `.env.hr-dev.example` (§3). |
| `REFUSING TO START: … still holds the placeholder` | Paste the real publishable key in place of `sb_publishable_REPLACE_ME`. |
| `REFUSING TO START: … PRODUCTION …` | Your file mentions `zfjeflpvwizlteflypsx` (the live site). Use only the HR dev values. |
| `REFUSING TO START: … SECRET key` | You pasted an `sb_secret_…` key. Delete it from the file and use the publishable key. Tell the owner, so the leaked key can be rotated. |
| `Dependencies are not installed` | Run `npm ci` in the project folder. |
| `npm warn install-scripts esbuild@… (postinstall: node install.js)` during `npm ci` | Harmless with npm 11: esbuild's platform binary is installed anyway, and the app starts and builds normally (checked 2026-11-07). No action needed. |
| `Node.js … is too old` | Install Node.js 22 or 24 LTS, then open a new terminal. |
| `Port 8080 is already in use` | Close the other program, or `node scripts/hr-dev/start.mjs --port 3000`. |
| `STOPPED: the browser configuration is NOT the HR development project` | Something overrides the Vite settings (for example a `VITE_SUPABASE_URL` in a custom `.env.development.local`). Remove it and start again. |
| Sign-in says "Invalid login credentials" | Wrong password or Employee ID (Employee IDs aren't case-sensitive). Ask the owner; don't try many times. |
| "Too many requests" / rate limited | Supabase Auth limits repeated sign-in attempts. Wait a few minutes. |
| Suddenly back on `/login` with "Your session has ended. Please sign in again." | Someone changed that account's password, HR deactivated the login, or the person left. Sign in again, or ask HR. |
| "No portal access yet" | The account has no HR role, no linked employee with portal access, and isn't a website admin. Ask HR. |
| Change password / Login & Access fails (Failed to send a request / 404) | The HR dev Edge Functions aren't deployed yet (see `EDGE_FUNCTION_DEPLOYMENT.md`), or you're on a port other than 8080/3000 (CORS). |
| Website Admin's Search Console / SEO panels show errors | Expected on HR dev: those functions are only deployed on production. |
| Page is blank, console says "can't detect preamble" | Vite reloaded mid-load. Refresh the page. |

## 9. Information the owner shares privately

Use a password manager share or tell each other in person. Never use GitHub, email, chat history or screenshots.

1. HR dev **publishable key** (`sb_publishable_…`).
2. **Password** for each account you're allowed to use: `info@zyllotech.com`, `hradmin@zyllotech.com`, Employee ID `ZT-0001`.
3. Only if you'll apply migrations: the HR dev **database URL**.
4. Only if you'll use the dashboard or deploy: a **Supabase organisation invite** to your own email.

Never shared: the HR dev **secret/service-role key** (it stays in Supabase) and anything from the **production** project.
