# Project Tracker — user guide

Project Tracker is part of the Zyllo Tech admin (`/admin`). It is organised **company → projects →
project details**: each client company has any number of projects, and each project keeps everything
about itself in one place: hosting, domains, mailboxes, credentials,
backups, source code, updates, AMC and renewals, SEO set-up, tasks, documents and handover.

## Signing in

There is no separate Project Tracker login or password. Sign in at **/login** with your normal Zyllo Tech
admin account, open the admin area and choose **Project Tracker** in the sidebar (Project Overview,
Companies, All Projects, …). Signing out of the admin area signs you out of Project Tracker too.

## Who can use it

Only website admins (the same check the rest of the admin area uses, done on the server). Within Project Tracker each admin has a role:

| Role | Can |
|---|---|
| Viewer | read everything except credential references and passwords |
| Editor (default for admins) | + create, edit and archive records; upload documents; prepare handovers |
| Manager | + view credential references and (once a vault is enabled) show/copy passwords — all logged; approve and complete handovers, restore archived records, manage roles (Project Overview → **Access**) |

## Finding your way

The normal path is **Project Tracker → Companies → a company → a project → its details**.

Sidebar → **Project Tracker**:

* **Project Overview** — dashboard: Total Companies, Total Projects, Live, In Progress, Under
  Maintenance and Pending Handover (each opens the matching list), attention tiles (missing backups,
  overdue verification, missing admin details, missing documentation, overdue tasks, SSL expiry,
  projects without a company), Recent Projects, upcoming domain / hosting / AMC renewals (7–60 day
  window) and Recent Activity. **+ Add Company** and **+ Add Project** are at the top.
* **Companies** — the company master: search, filter by status, show archived, sort, page. Each row
  shows total, live and in-progress projects. Click a company to open it.
* **All Projects** — the register. Search, filter (status, category, priority, attention,
  renewal due, date range), sort any column, page through results. Click a project to open it.
* **Hosting & Domains, Emails & Accounts, Backups, AMC & Renewals, Handover Records** —
  the same records across all projects.
* **Reports** — ten reports with CSV, Excel and Print/PDF.

## Companies

* **Add Company**: name (required, unique among active companies), optional short code (unique), type,
  status, website, contact person / email / phone, country / state / city / address, remarks. The
  Company ID (`ZT-CO-0001…`) is generated automatically.
* **Company page**: breadcrumb *Project Tracker → Companies → name → Projects*, company information,
  a project summary (total, live, in progress, under maintenance, completed, pending handover — each
  opens the filtered list), the company's projects and recent activity. **Add Project** here
  preselects the company.
* **Archive a company** only after its projects are archived (or moved to another company by a
  manager) — the system refuses otherwise. Archived companies are read-only; managers restore them.
  Companies are never deleted.
* Projects created before companies existed show as **Unassigned**; open them and choose the company
  in *Edit Project*.

## A project's workspace

The breadcrumb reads *Companies → company → Projects → project*. The header shows the project name and ID, company, status, live URL, responsible person, last
update and **documentation completeness**, with **Edit Project**, **Generate Report** and
**Archive**. Below are 13 sections; a coloured dot shows each section's documentation state
(green complete, amber partial, red missing).

* **Overview** is laid out in three columns: *Project Summary* (name, ID, company, type, status, dates,
  URLs, responsible person, description), *Key Information* cards (hosting provider, primary domain,
  email accounts, backup status, AMC status, SEO status, documents, handover status — each opens its
  section) with *Recent Activity* below, and the *Handover Checklist* with progress. Latest update,
  documentation completeness and applicable sections follow underneath. On a phone, pick sections from
  the **Section** drop-down.
* **Documentation completeness ≠ development progress.** Progress (%) is how far the build is.
  Completeness is how well the project is *documented*. Mark sections that don't apply (e.g. no
  domain for an internal tool) in Project Overview → *Applicable sections*; they are then not
  counted. AMC and SEO count only when marked applicable in their tabs.
* **Hosting:** add one record per provider/environment. When you move providers, set the old
  record to *Migrated* and choose where it moved — the history stays.
* **Credentials & Access:** one record per login — pick the **Credential Type** first (Email, Hosting
  panel, Website admin, Supabase, Database, Domain registrar, GitHub, cPanel, VPS/SSH, Cloudflare,
  Vercel, Render, third-party, API service, Other); the form then shows the matching fields (provider,
  hosting type, environment, organisation, provider project, server/account reference, renewal date,
  purpose). Every record has service name, email/username, login URL, owner, role/access level,
  responsible person, 2FA status, rotation/verification dates, status and remarks. Use the type buttons
  above the list to filter. Projects can have any number of records of each type.
  * **Passwords.** The badge above the list says which mode is active:
    * **Vault: not configured** (today, and on any project without an approved vault): the Password
      field and the Show/Copy buttons are visible but disabled. **No password is saved.** Keep it in the
      password manager and use **Set reference** to note where (e.g. *1Password › Clients › Acme ›
      cPanel*). Managers can **View reference**; each view is logged and the dialog hides after 60 s.
    * **Vault: encrypted** (only after the vault is approved, enabled and verified): type the password
      in the form or use **Set password**. The list shows `••••••••••`. A **manager** can click the
      eye to show it — it hides again automatically (30 s by default) or with the eye-off button — or
      **Copy** it without displaying it (the clipboard is not cleared automatically; clear it yourself).
      If your sign-in is older than the re-authentication window (10 min by default) you are asked to
      enter **your own** admin password first. Editors can save or change a password but never see it.
      Managers can **Remove** a stored password. Every save, change, show, copy, refusal and removal is
      written to the activity log — never the password itself.
    * **Vault: TEST DOUBLE** appears only on the local test harness (plaintext, synthetic passwords).
  * The same Password column (and Set password action) appears in **Emails & Accounts** and **Hosting
    & Servers**; each mailbox or hosting account gets its own linked credential record.
  * Never enter API keys, service-role keys, tokens or recovery codes anywhere — fields that look like
    them are rejected.
* **Backups:** a backup moves Scheduled → Completed (needs date/time and protected storage
  location) → Verified (needs who, when and evidence). Tick *Restore tested* with date and
  evidence after a restore drill. Never paste public backup links.
* **AMC & Renewals:** *Renew* an AMC to create the next contract (the old one stays as
  history). Add independent renewals (hosting, domain, SSL, email, subscriptions) and use
  **Complete** with evidence; a new expiry date also updates the linked domain/SSL/hosting record.
* **Documents & Handover:** **Upload / link** opens the upload window. Drag files onto it or use
  **Browse…** — several files at once, each with its own document name and a progress bar. Allowed:
  PDF, Word (doc/docx), Excel (xls/xlsx), PowerPoint (ppt/pptx), PNG/JPG/JPEG/WebP, TXT, CSV, MD, ZIP,
  MP4/WebM/MP3; up to 50 MB each (the limit is a server setting). Other types (e.g. .exe, .svg, .html)
  and larger files are refused in the browser **and again by the server**, which checks the stored
  file's real size and type. Choose category, version, visibility (*Restricted* = managers only),
  optional task, description and remarks. For very large items (training recordings) add an
  access-controlled **External link** instead.
  * **New version** replaces a document: the new file becomes current, the old one is kept. The list
    shows current versions; tick **Show previous versions** to see all. **History** lists every
    version with who uploaded it and when, and each can still be downloaded.
  * **Open / Download** use private links valid for 60 seconds. **Preview** is offered for images and
    plain text only; Office files are downloaded. Every open, download and preview is logged.
  * Files are stored privately and never deleted — archive a document to retire it. No malware
    scanner is connected yet; Project Tracker never runs or renders uploaded files.
* **Handover:** *Start handover* creates the 15-item checklist. Each item needs evidence (a
  note or a document); four items can never be "Not applicable". Enter the recipient, date and
  signed approval document, then **Submit for review** (the checklist locks). A manager
  **Approves**, then **Records handover completed** with a written confirmation. Send back to
  Draft (with a reason) to change anything.
* **Activity & Remarks:** an automatic, unchangeable history of what changed, when and by
  whom (never the values of secrets), plus free-text remarks.

## Archiving

Archive a project (with a reason) when it is finished with. It becomes read-only and leaves
lists, alerts and KPIs (except *Archived Projects*). Nothing is deleted. Managers can restore it
to its previous status.

## Alerts

Alerts appear in the admin only. **No automatic emails are sent** — no scheduler or mail
service is configured for Project Tracker.

## Reports

Pick a **Company** at the top of the Reports page to turn any register into a company report
(e.g. Company Hosting Register, Company Domain Renewal Report, Company Email Account Inventory,
Company Backup Report, Company AMC Report, Company Handover Status Report).

All Companies Report, Company Project Summary, Complete Company Project Register, Project Hosting Register, Domain Expiry, Hosting Renewal (choose window), Email Account
Inventory, Backup Status, AMC Renewal, Missing Information, Project Update History, Handover
Readiness, and the Complete Project Information Report (from a project's **Generate Report**,
with Excel and Print/PDF). Exports never include passwords, keys, tokens, recovery codes,
vault references, storage paths or document links. The Password column in exports only says whether a
password is stored ("Stored in vault" / "Not stored").
