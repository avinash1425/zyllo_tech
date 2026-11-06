# HR development Edge Functions: deployment (development project ONLY)

**Target:** HR development Supabase project **`whiclllqgxxqhufkduuo`**.
**Never:** the production project `zfjeflpvwizlteflypsx` (the live zyllotech.com).

This deploys the two Edge Functions that the Employee ID workflows need. It changes no database records, policies, migrations, users, passwords or project settings. It only adds two functions to the HR development project.

> Status: **deployed to HR development on 2026-11-07**, with the owner's approval. `hr-employee-login` v1 and `hr-change-my-password` v1, `verify_jwt=false`, from commit `9afe73d`. Verified: CORS for `http://127.0.0.1:8080`, `http://localhost:8080` and `http://127.0.0.1:3000`; 401 without or with an invalid token; 400 on invalid input for a signed-in HR Admin and Employee (no data changed). `ALLOWED_ORIGINS` isn't set, so the default list applies. The website functions already on HR dev (`ai-search`, `search-console`, `seo-audit`, `sitemap`) were left unchanged.

## 1. Which functions, and why

| Login workflow | Needs an Edge Function? |
|---|---|
| Website Admin sign-in (`info@…` → `/admin`) | **No.** Supabase Auth + `public.is_admin()` |
| HR Admin sign-in (`hradmin@…` → `/hr`) | **No.** Supabase Auth + `public.hr_me()` |
| Employee ID sign-in (`ZT-0001` → `/employee`) | **No.** The app maps the ID to `zt-0001@staff.zyllotech.com` and uses Supabase Auth |
| HR → Employee → **Login & Access** (create / reset / activate / deactivate an Employee ID login) | **Yes: `hr-employee-login`** |
| **Change password** (incl. forced change of a temporary password at `/employee/set-password`) | **Yes: `hr-change-my-password`** |

**Not needed for these workflows:**
- `hr-revoke-exit-access` (ends sessions when someone leaves).
- `hr-invite-employee` and `hr-email-dispatch` (email invitations; email is off for Employee ID accounts).
- `hr-document-reminders`.
- The website functions `ai-search`, `sitemap`, `seo-audit` and `search-console`.

Both functions share code in `supabase/functions/_shared/`: `cors.ts`, `hr.ts`, `employee_login.ts`. The CLI bundles it automatically.

### What each function does and checks

**`hr-employee-login`**: `POST { employee_id: uuid, action: "create" | "reset" | "activate" | "deactivate" }`
1. Requires `Authorization: Bearer <user access token>`, validated with the Auth server (`auth.getUser()`).
2. Validates the input (`400` for a bad UUID or action).
3. Checks permission **as the caller** with `public.hr_can_manage_login()` (needs `employees.manage_login`; `403` otherwise).
4. Only then uses the service role to create, reset, ban or unban the Auth user and record it (`hr_link_employee_login`, `hr_begin_password_reset`, `hr_set_employee_login_active`).
5. `create` and `reset` return a one-time `temporary_password`, which is never logged or stored. Unexpected errors return a generic `500` without internals. All responses are `Cache-Control: no-store`.

**`hr-change-my-password`**: `POST { current_password, new_password }`
1. Same Bearer-token validation.
2. Input checks (`400`), then a session check (`401` if the session has ended).
3. `hr_own_login_for_password_change()` confirms the account may change its password (`403` otherwise).
4. Verifies the current password through Auth, sets the new one with the service role, then calls `hr_complete_own_password_change()`.
5. Every session of that user ends; the app signs in again with the new password.

**Environment inside the function runtime.** Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically, so there's **nothing to set**. The service-role key never leaves Supabase.
- Optional `ALLOWED_ORIGINS` (comma-separated) replaces the default CORS list. That list includes `http://127.0.0.1:8080`, `http://localhost:8080`, `http://127.0.0.1:3000`, `http://localhost:3000`, `http://localhost:5173`, the production domains and Lovable previews.

**Database prerequisites** (already true on HR dev, checked read-only on 2026-11-07):
- Migrations **200/201/202** are applied.
- `hr_can_manage_login`, `hr_link_employee_login`, `hr_begin_password_reset`, `hr_set_employee_login_active`, `hr_own_login_for_password_change`, `hr_complete_own_password_change`, `hr_me` and `is_admin` all exist.

**JWT verification.** HR dev signs user tokens with the new asymmetric keys (`ES256`; see `https://whiclllqgxxqhufkduuo.supabase.co/auth/v1/.well-known/jwks.json`).
- The gateway's legacy `verify_jwt` check is built for the old shared-secret (HS256) tokens, so deploy with **`--no-verify-jwt`**.
- That's safe here: both functions reject any request without a valid Bearer token, checked with the Auth server in code, before reading the body.
- `supabase/config.toml` is **not** changed, so production settings are untouched.

## 2. Prerequisites (one time)

1. **Supabase CLI.** Use it through `npx` from the repository (v3.0.0 is on the owner's PC). In v3, a project is selected with **`--remote=<ref>`**; there is no `--project-ref`.
2. **Sign in** with an account that is a member of the organisation owning `whiclllqgxxqhufkduuo`:
   ```powershell
   npx supabase login
   ```
   This opens the browser. Alternatively, set `$env:SUPABASE_ACCESS_TOKEN` for the current PowerShell window only; never write it to a file.
3. **Do not run `supabase link`** in this repository. The repo is intentionally unlinked (checked 2026-11-07), so any command without `--remote` fails instead of hitting a default project. Every command below names the HR dev project explicitly.
4. **No Docker needed:** `--use-api` bundles on Supabase's servers.
5. **Check existing function secrets** (read-only; it shows names and digests, never values):
   ```powershell
   npx supabase secrets list --remote=whiclllqgxxqhufkduuo
   ```
   If `ALLOWED_ORIGINS` is listed, it must include `http://127.0.0.1:8080`. Otherwise Login & Access and Change password fail with a CORS error. Changing secrets is a separate, approved step. (On 2026-11-07 it wasn't set.)

## 3. Deploy (only after approval)

Run from the repository root, on a clean checkout of `feature/zyllo-hrms-employee-portal` (or of a later reviewed commit). PowerShell:

```powershell
# Safety: HR development only, and no linked default project.
$ref = "whiclllqgxxqhufkduuo"
if (Test-Path supabase/.temp/project-ref) { throw "Refusing: this checkout is linked to a Supabase project. Remove the link first." }
git status --short            # must print nothing (deploy exactly the reviewed code)
git log -1 --format="%h %s"   # note the commit being deployed

npx supabase functions deploy hr-employee-login     --remote=$ref --no-verify-jwt --use-api
npx supabase functions deploy hr-change-my-password --remote=$ref --no-verify-jwt --use-api
# In a non-interactive shell the CLI asks for --yes; check that its confirmation line names whiclllqgxxqhufkduuo.
```

Rules:
- Name each function. **Never** run `supabase functions deploy` without a function name: that deploys every function in the folder, including the website's.
- **Never** use `--prune`: it deletes functions that exist only in the project.
- When the CLI asks you to confirm a hosted change, check that it names `whiclllqgxxqhufkduuo`.

## 4. Verify (non-mutating)

**a) Deployed, and CORS allows the local app** (no sign-in needed):
```powershell
$base = "https://whiclllqgxxqhufkduuo.supabase.co/functions/v1"
foreach ($fn in "hr-employee-login","hr-change-my-password") {
  $o = Invoke-WebRequest -Method Options "$base/$fn" -Headers @{ Origin = "http://127.0.0.1:8080"; "Access-Control-Request-Method" = "POST" } -UseBasicParsing
  "$fn OPTIONS $($o.StatusCode) allow-origin=$($o.Headers['Access-Control-Allow-Origin'])"
  try { Invoke-WebRequest -Method Post "$base/$fn" -UseBasicParsing | Out-Null } catch { "$fn POST (no token) -> $($_.Exception.Response.StatusCode.value__)" }
}
```
Expected:
- `OPTIONS 200 allow-origin=http://127.0.0.1:8080`
- `POST (no token) -> 401`

A `404` means the function isn't deployed.

**b) Wired to Auth and the service role** (signed in, still changes nothing). Start the app (`node scripts/hr-dev/start.mjs`) and sign in as **HR Admin** in its own browser window. Open DevTools → Console and paste:
```js
const t = JSON.parse(localStorage.getItem("sb-whiclllqgxxqhufkduuo-auth-token")).access_token;
const call = (fn, body) => fetch(`https://whiclllqgxxqhufkduuo.supabase.co/functions/v1/${fn}`, {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then(async (r) => [r.status, await r.json()]);
console.log(await call("hr-employee-login", { employee_id: "not-a-uuid", action: "create" }));
console.log(await call("hr-change-my-password", {}));
```
Expected:
- `[400, {error: "employee_id must be a UUID."}]`
- `[400, {error: "Enter your current password."}]`

Both are rejected by input validation **before** any change. A `500` means the function can't read its runtime keys; check the function logs in the dashboard. Never copy the token anywhere.

**c) In the app (read-only):**
- HR Admin → Employees → ZT-0001 → **Login & Access** shows the login status.
- `ZT-0001` → account menu shows **Change password**.

**Do not** click Create, Reset, Activate, Deactivate or save a new password on shared accounts without the account owner's agreement. Those are the real, data-changing actions.

## 5. Roll back

Removing the functions returns HR dev to its current state. No data is involved:
```powershell
npx supabase functions delete hr-employee-login     --remote=whiclllqgxxqhufkduuo
npx supabase functions delete hr-change-my-password --remote=whiclllqgxxqhufkduuo
```
To roll back to an earlier code version instead, check out that commit and redeploy with the commands in §3.

## 6. Production safeguards

- **Production is out of scope.** Never deploy these functions to `zfjeflpvwizlteflypsx` without a separate, reviewed production release, which would also need migrations 200–202 applied there first.
- Always pass `--remote=whiclllqgxxqhufkduuo`. The repository stays **unlinked**.
- Never deploy without function names, and never use `--prune`.
- Keep `supabase/config.toml` unchanged for this. It drives the production website functions.
- Never put the service-role or secret key in a file, the frontend, a `VITE_` variable, logs or chat. The functions get it from the Supabase runtime.
- After deploying, record the deployed commit (`git log -1`) in the pull request or release notes.
