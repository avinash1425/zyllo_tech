# Project Tracker + Employee Portal — run it on your own computer

This branch (`project-tracker`) is the Zyllo Tech website plus:

- **Admin side** (`/admin`): Project Tracker (dashboard, Clients, Access & Logins) and the **Employee Portal**
  admin pages (Employee Portal dashboard, Employee Management, Project Management, Attendance, Leave,
  Daily Work Reports, Notifications).
- **Employee side** (`/employee`): punch in / out, Dashboard, Attendance (+ corrections), My Profile,
  My Projects, Daily Work Report, Leave, Notifications, first-sign-in password change.

There is **one login page** (`/login`) for everybody: an admin lands on `/admin`, an employee lands on `/employee`.

When you follow these steps you see **exactly what the project owner sees**: the same clients, projects,
logins, documents, employees, attendance, reports and leave — and **the same usernames and passwords work**,
because you connect to the same (dev) database. Nothing about accounts is stored in the code.

## What you need

| | |
|---|---|
| Git and **Node.js 20 or newer** | `node -v` should print v20 or higher |
| The **database details** | Project ID, URL and anon / publishable key — the project owner sends them privately (never in Git; this repo is public) |

## Steps

```bash
git clone https://github.com/avinash1425/zyllo_tech.git
cd zyllo_tech
git checkout project-tracker
npm install
```

Create your private settings file from the template:

```bash
# macOS / Linux / Git Bash
cp .env.tracker.example .env.tracker.local
# Windows PowerShell
Copy-Item .env.tracker.example .env.tracker.local
```

Open `.env.tracker.local` and replace the three `<…>` values with the details the project owner sent you
(or simply use the `.env.tracker.local` file they sent you, placed in the project folder).

Start the site:

```bash
npm run dev:tracker
```

Open the address shown in the terminal (for example `http://localhost:8080`) and go to **/login**.

- Sign in with an **admin** login → you land on `/admin` (sidebar: Projects, Employee Portal, …).
- Sign in with an **employee** login (Employee ID / sign-in ID created in Admin → Employee Management)
  → you land on `/employee` and are asked to punch in.

> `npm run dev` (without `:tracker`) connects to the **live website** database, which does not have the
> Project Tracker / Employee Portal tables — those pages would say "database is not up to date".
> Always use `npm run dev:tracker`.

## Accounts

- Accounts live in the database, so the logins the project owner uses work for you too.
- A separate admin account for yourself: create it (Supabase → Authentication → Users, or **Sign Up** on
  `/login`) and the project owner adds one row for it in `admin_users`. Sign out and in again.
- Employee accounts are created by an admin in **Admin → Employee Management → Add employee**. The
  temporary password is shown once; the employee must change it at first sign-in.

## Good to know

- **Everything you change is shared**: adding, editing or deleting a client, project, login, document,
  employee, attendance, leave or report changes it for everyone, including the project owner.
- **Scheduled jobs run in the database**, not on your computer: auto punch out at 8 PM IST and the
  reminders (punch in, daily report, punch out, deadlines, custom reminders) run on the server even when
  nobody has the site open.
- **Saved passwords** (Access & Logins, Backups) are stored encrypted. Showing, copying or downloading them
  asks you to confirm your own login password if you signed in more than 10 minutes ago, and every view,
  copy and download is recorded in the password access log.
- **Excel downloads** of logins include the passwords. Treat downloaded files as confidential.
- Uploaded logos, documents and internship certificates are private files; they open through short-lived links.
- Email addresses are intentionally hidden in the Employee Portal screens (no emails are sent yet).

## Database (for whoever sets up a new Supabase project)

Apply `supabase/migrations/220_…sql` to `250_…sql` in order (220–228 Project Tracker, 229–250 Employee
Portal). Each has a rollback in `supabase/rollbacks/`. They need the `supabase_vault` and `pg_cron`
extensions and a `public.is_admin()` function that returns true for website admins. The shared dev database
already has all of them. The **live website** database has 220–228 only — the Employee Portal is not live yet.
