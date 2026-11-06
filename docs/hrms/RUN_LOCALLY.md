# Run the HRMS locally: offline synthetic testing

This starts the HR Operations and Employee Portal on your own computer. It uses a **throwaway local database** and a **local stand-in for Supabase**. Nothing connects to any hosted Supabase project, no email is sent, and all people in it are fictional.

| | Offline synthetic testing (this guide) | Shared hosted HR development ([`COWORKER_SETUP.md`](COWORKER_SETUP.md)) |
|---|---|---|
| Database | Throwaway local PostgreSQL, fresh demo data each start | Hosted HR dev project `whiclllqgxxqhufkduuo`, shared by the team |
| Accounts | Fictional `…@example.com` test accounts below | Real development accounts (Website Admin, HR Admin, Employee ID) |
| Changes | Deleted when the harness stops | Persist, and everyone sees them immediately |
| Start with | `node scripts/hrms-local/start.mjs` | `node scripts/hr-dev/start.mjs` |
| Use for | Experiments, destructive tests, automated test runs | Working on and reviewing with the team's development data |

Neither ever touches production. Plain `npm run dev` uses the committed `.env`, which points at the **live** project, so don't use it for HRMS work.

For harness internals (options, test scripts, running several harnesses side by side) see [`scripts/hrms-local/README.md`](../../scripts/hrms-local/README.md).

## 1. Install once
- **Node.js 20 or newer**: https://nodejs.org
- **PostgreSQL 17**: https://www.postgresql.org/download/
  - You only need the program files; no database or service has to be set up.
  - On Windows the default install folder `C:\Program Files\PostgreSQL\17\bin` is found automatically.
  - Elsewhere, set `PG_BIN` to the folder containing `initdb`, `postgres` and `psql`.

## 2. Get the code
```bash
git clone --branch feature/zyllo-hrms-employee-portal https://github.com/avinash1425/zyllo_tech.git
cd zyllo_tech
npm install
```
- The HRMS is under review on the `feature/zyllo-hrms-employee-portal` branch. Once it is merged, clone the default branch instead (drop `--branch …`).
- The old `hrms` branch has been retired. Its last version is kept as the tag `archive/hrms` (`git clone --branch archive/hrms …`), for reference only.

## 3. Start
```bash
node scripts/hrms-local/start.mjs
```
- **Startup:** wait for the box headed `Zyllo HRMS LOCAL TEST HARNESS`. It takes about 1–2 minutes the first time.
- **Expected warnings:** a few `WARN … site migration did not replay` lines are normal. They are website migrations the HRMS does not need.
- **Then open:** **http://127.0.0.1:8090/login**. This one sign-in page serves HR Admin, Employee and Website Admin; each account is sent to its own area (`/hr` or `/employee`). The old `/hr/login` and `/employee/login` addresses redirect there.
- **Ports:** if 54321 or 8090 is busy, use `node scripts/hrms-local/start.mjs --port-api 54400 --port-web 8200` and open port 8200 instead.

## 4. Sign in
The password for every account is **`Local-Test-Only-2026!`**

| Email | Lands on | Can do |
|---|---|---|
| `superadmin@example.com` | HR Dashboard | Everything, in all 12 modules plus HR Settings |
| `hr.admin@example.com` | HR Dashboard | HR work in all modules except Payroll, plus their own Employee Portal |
| `payroll.admin@example.com` | Employee Management | Payroll & Salary, payroll requests and reports |
| `payroll.approver@example.com` | Employee Management | Second payroll approver, for two-person approval |
| `manager@example.com` | HR Dashboard (team) | Their team's attendance, leave, daily reports and approvals |
| `employee@example.com` | Employee Portal | Self-service. Demo Engineer 03, reporting to the manager |
| `employee2@example.com` | Employee Portal | Another team, for checking data isolation |
| `intern@example.com` | Employee Portal | Intern view of the Employee Portal |
| `noaccess@example.com` | "No portal access yet" | Signed in with no HR role |

Accounts you invite from HR while testing get the password `Local-Invite-Only-2026!`.

**Employee ID sign-in** (e.g. `ZT-0007` instead of an email) is part of the app, but the local harness does not emulate the `hr-employee-login` Edge Function, so use the email accounts above locally. Test Employee ID sign-in against the HR development Supabase project ([`COWORKER_SETUP.md`](COWORKER_SETUP.md)).

## 5. Stop
Press **Ctrl+C** in the start window, or run `node scripts/hrms-local/stop.mjs`.

The database is deleted when the harness stops. Every start begins with fresh demo data.

## Notes
- These accounts exist **only** in this local harness. They do not work on the live site.
- If the start window says *"A harness is already running"* after a crash, run `node scripts/hrms-local/stop.mjs` and start again.
- **Database tests** (no browser): `node scripts/hr-db-test.mjs`. It ends with `N/N test files passed`; every file should pass.
