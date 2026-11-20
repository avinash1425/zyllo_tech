# Project Tracker — run it on your own computer

This branch (`project-tracker`) is the Zyllo Tech website plus the **Project Tracker** admin module
(Project Tracker dashboard, Client Companies, Access & Logins). The HR and Employee portals are not part of it.

When you follow these steps you see exactly what the project owner sees: the same companies, projects,
logins, documents and backups, because you connect to the same Project Tracker database.

## What you need

| | |
|---|---|
| Git and **Node.js 20 or newer** | `node -v` should print v20 or higher |
| The **Project Tracker database details** | Project ID, URL and anon / publishable key — ask the project owner (sent privately, never in Git) |
| A **website admin login** on that database | Ask the project owner to give your account admin access (see "Getting access" below) |

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

Open `.env.tracker.local` and replace the three `<…>` values with the details the project owner sent you.

Start the site:

```bash
npm run dev:tracker
```

Open the address shown in the terminal (for example `http://localhost:8080`), go to **/login**, sign in,
and in the admin sidebar open **Projects → Project Tracker**, **Client Companies** or **Access & Logins**.

> `npm run dev` (without `:tracker`) connects to the **live website** database, which does not have the
> Project Tracker tables — the Project Tracker pages would say "database is not up to date". Always use
> `npm run dev:tracker` for the Project Tracker.

## Getting access

Everything in the Project Tracker is limited to **website admins** of the Project Tracker database.

1. Create your account: on **/login** choose **Sign Up** (or the project owner creates the user in
   Supabase → Authentication → Users). Use your own email and your own password — never share passwords.
2. The project owner makes your account an admin of that database (one row in `admin_users`).
3. Sign out and sign in again. The **Projects** section appears in the admin sidebar.

Until step 2 is done you will see "Not authorised" on `/admin`.

## Good to know

- **Saved passwords** (Access & Logins, Backups) are stored encrypted. Showing, copying or downloading them
  asks you to confirm your own login password if you signed in more than 10 minutes ago, and every view,
  copy and download is recorded in the password access log with your email.
- **Excel downloads** of logins include the passwords. Treat downloaded files as confidential and delete them
  when done.
- **Everything you change is shared**: you work on the same data as the project owner, so adding, editing
  or deleting a company, project, login or document changes it for everyone.
- Uploaded logos and documents are private files in that Supabase project; they open through short-lived links.

## Database (for whoever sets up a new Supabase project)

The tables are created by `supabase/migrations/220_…sql` to `227_…sql`, in order. Each has a rollback in
`supabase/rollbacks/`. They need the `supabase_vault` extension (installed on Supabase projects by default)
and a `public.is_admin()` function that returns true for website admins. They are **not** applied to the
live website project.
