# Project Tracker + Employee Portal — run it on your own computer

This branch (`project-tracker`) is the Zyllo Tech website plus:

- **Admin side** (`/admin`): Project Tracker (dashboard, Clients, Access & Logins) and the **Employee Portal**
  admin pages (Employee Portal dashboard, Employee Management, Project Management, Attendance, Leave,
  Daily Work Reports, Notifications).
- **Employee side** (`/employee`): punch in / out, Dashboard, Attendance (+ corrections), My Profile,
  My Projects, Daily Work Report, Leave, Notifications, first-sign-in password change,
  My documents (employee uploads certificates / ID proofs; the admin sees them on the employee's page).
- **Admin Notifications** (`/admin/inbox`, bell in the admin top bar): the admin is notified automatically
  when employees apply for / cancel leave, punch in late, forget to punch out, request corrections, submit
  reports, work on project tasks, change their profile / documents, or sign in for the first time.

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

Open **`http://localhost:8080`** (the "Local" address shown in the terminal) and go to **/login**.

> Use `localhost` on your own computer. The "Network" address (`http://192.168…:8080`) also opens the site,
> but browsers treat it as "not secure", so the **Copy** buttons (passwords, logins) do not work there.
> Uploads work on both.

- Sign in with an **admin** login → you land on `/admin` (sidebar: Projects, Employee Portal, …).
- Sign in with an **employee** login (Employee ID / sign-in ID created in Admin → Employee Management)
  → you land on `/employee` and are asked to punch in.

> `npm run dev` (without `:tracker`) connects to the **live website** database, which does not have the
> Project Tracker / Employee Portal tables — those pages would say "database is not up to date".
> Always use `npm run dev:tracker`.

## Accounts

- **Roles & permissions** (Admin → Settings): Super Admin, Admin, HR, Manager, Team Lead, Employee.
  Settings → Users & Roles gives people roles; Settings → Roles & Permissions decides what each role may
  do, per action (view / create / edit / delete / download / approve / export / see passwords). The
  database enforces it too. Existing admins became Super Admin automatically.

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

Apply `supabase/migrations/220_…sql` to `270_…sql` in order (220–228 Project Tracker, 229–270 Employee Portal + roles
Portal). Each has a rollback in `supabase/rollbacks/`. They need the `supabase_vault`, `pgcrypto` and `pg_cron`
extensions and a `public.is_admin()` function that returns true for website admins. The shared dev database
already has all of them.

The **live website** database (Lovable Cloud) gets the same structure — no data — from two one-step scripts
run in Lovable Cloud → SQL editor, in this order:

1. `supabase/live/project_tracker_schema_220-228.sql` (already done)
2. `supabase/live/employee_portal_schema_229-252.sql` (already done)
3. `supabase/live/employee_portal_253-268_updates.sql` (editable Employee ID, leave order: reporting
   manager reviews -> admin approves -> manager gives the final approval, Admin Notifications)
4. `supabase/live/employee_portal_269-270_updates.sql` (several roles per person + top-bar role switcher;
   Late after 10:05 AM; unread notifications first)

Each runs as one transaction (all or nothing). The two schema scripts refuse to run twice; the updates
script is safe to run again.

## Email (daily report "Send by email")

Emails are sent by the database through **Resend** (https://resend.com), from
`<employee> via Zyllo Tech <info@zyllotech.com>`; replies go to the employee's sign-in email.
Set it up once per database (dev and live):

1. **Resend:** create an account → Domains → add `zyllotech.com` → add the DNS records Resend shows
   (TXT/MX) where the domain's DNS is managed → wait until it says *Verified*. Then API Keys → create a key
   with *Sending access*.
2. **pg_net** must be enabled: Supabase Dashboard → Database → Extensions → `pg_net` (dev already has it).
3. **Store the key in the Vault** (Supabase / Lovable Cloud → SQL editor), replacing the placeholder:
   ```sql
   select vault.create_secret('re_YOUR_KEY_HERE', 'resend_api_key');
   ```
   To change it later: `select vault.update_secret((select id from vault.secrets where name = 'resend_api_key'), 're_NEW_KEY');`

The same setup sends **welcome emails**: when an admin adds an employee or user, the sign-in email and a
one-time password are emailed to them (they choose their own password at the first sign-in). Every 5 minutes
the database asks Resend about recent welcome emails; a bounce raises the urgent admin notification
"Mailbox does not exist", and the admin can use "Change sign-in email & resend".

Until both are in place, "Send email" answers "Email is not set up yet". Each send shows *Sending → Sent* or
*Failed* with Resend's reason (e.g. domain not verified).
