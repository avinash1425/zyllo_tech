# HRMS: dev environment setup and deployment prerequisites

Nothing in this guide touches the live Supabase project. Production rollout is a separate, owner-approved step (see the end).

## 1. Create the isolated dev Supabase project (owner action)
1. Go to https://supabase.com/dashboard and create a **new project**. Call it, for example, `zyllo-hrms-dev`. Do **not** reuse the live Zyllo Tech project.
2. Collect these values from the new project:
   - **Project ref**: the `xxxx` in `https://xxxx.supabase.co`.
   - **Direct database URL**: Project Settings > Database > Connection string > URI. It contains the database password.
   - **API URL and publishable (anon) key**: Project Settings > API.
3. Create these two files in the repo root. Both are ignored by Git (`.env.*.local` and `.env.local`), so they will never be committed.

   `.env.hr-dev.local`, used by the migration script:
   ```
   HR_DEV_PROJECT_REF=<dev project ref>
   HR_DEV_DATABASE_URL=postgresql://postgres:<password>@db.<dev ref>.supabase.co:5432/postgres
   ```
   `.env.local`, which points the local site at the DEV project. It overrides `.env` on this machine only:
   ```
   VITE_SUPABASE_URL=https://<dev ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<dev anon/publishable key>
   ```
   Never put a service-role key in any `VITE_` variable.

## 2. Apply the schema to the dev project
```
node scripts/hr-db-apply.mjs --dry-run              # lists what would run
node scripts/hr-db-apply.mjs --with-base --seed     # first time: public-site schema + HR migrations + synthetic seed
node scripts/hr-db-apply.mjs                        # later: only new migrations
```
The script refuses to run if the target is the live project. It records each applied file in `hr_meta.applied_migrations`.

## 3. Deploy the Edge Functions to the dev project
```
npx supabase login
npx supabase functions deploy hr-invite-employee   --project-ref <dev ref>
npx supabase functions deploy hr-revoke-exit-access --project-ref <dev ref>
npx supabase functions deploy hr-email-dispatch    --project-ref <dev ref>
npx supabase secrets set HR_PORTAL_URL=http://127.0.0.1:8080 --project-ref <dev ref>
```
- **Email (optional):** to send email, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM`. Without these, queued emails are marked **failed** with a clear reason; they are never shown as sent.
- **Auth redirect URLs:** in Dashboard > Authentication > URL Configuration, add `http://127.0.0.1:8080/**` to Redirect URLs. Invitation links land on `/employee/activate`.
- **Self sign-up:** in Authentication > Sign In / Providers, disable "Allow new users to sign up". Accounts are created by HR invitation only.

## 4. Bootstrap the first Super Admin (dev)
1. Create your own login in Dashboard > Authentication > Users > Add user, using an email and password.
2. Then, in the SQL Editor of the **dev** project:
```sql
insert into public.hr_user_roles (user_id, role_key)
select id, 'super_admin' from auth.users where email = '<your email>';
```
3. Sign in at http://127.0.0.1:8080/login. You are routed to `/hr`.

## 5. Scheduled jobs (dev, then production)
Use Supabase Cron, or the pg_cron extension, with the service role:
- **Daily:**
  - `select public.hr_generate_document_expiry_reminders(30);`
  - `select public.hr_generate_daily_report_reminders(current_date);`
  - `select public.hr_mark_missing_punches(current_date - 1);`
- **Every 5 minutes:** `select public.hr_process_scheduled_announcements();` and an invocation of `hr-email-dispatch`.

(The exact function names for reports, attendance and announcements are listed in `PROGRESS.md` once their migrations are in.)

## 6. Production rollout: owner approval required, not done
Before production, all of these must happen:
1. Take a backup of the live project.
2. Review every `1NN_hr_*.sql` migration.
3. Apply the migrations without `--seed`. The synthetic seed must never reach production.
4. Deploy the Edge Functions and set their secrets.
5. Configure an email provider.
6. Bootstrap the Super Admin.
7. Verify statutory payroll components with a qualified professional.
8. Retire `server/`, or host it separately and keep its HR endpoints disabled.
9. Rotate any secret that has ever been in `server/.env`.
10. Untrack `server/zyllotech.db` and remove `src/data/allCandidateEmails.json`, including from Git history. See `SECURITY.md`.
