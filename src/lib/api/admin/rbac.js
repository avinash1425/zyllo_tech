// Settings -> Users & Roles / Roles & Permissions (migration 259). All checks happen in the database.
import { supabase } from "@/lib/supabase/client";
import { passwordProblem } from "@/lib/api/employee/password";

const KNOWN =
  /permission|Super Admin|own roles|Unknown role|automatically|Employee Portal accounts|already has an account|valid sign-in email|Name is required|Choose at least one role|admin-area|Password:|at least one Super Admin|belongs to the|one role|Choose a role|only for Employee Portal|cannot receive email/i;
const friendly = (error, fallback) => (KNOWN.test(error?.message ?? "") ? error.message : fallback);

/** { can_edit, roles: [{key, name, description, area, permissions:[], users}], permissions: [{key, area, group, label, description}] } */
export async function getRolesAndPermissions() {
  const { data, error } = await supabase.rpc("rbac_admin_roles");
  if (error) throw error;
  return data;
}

export async function setRolePermission(role, permission, enabled) {
  const { error } = await supabase.rpc("rbac_admin_set_permission", { p_role: role, p_permission: permission, p_enabled: enabled });
  if (error) return { ok: false, message: friendly(error, "Could not save the permission. Please try again.") };
  return { ok: true };
}

/** [{ user_id, sign_in, full_name, employee_code, employee_active, roles: [], last_sign_in_at, is_self }] */
export async function getUsers() {
  const { data, error } = await supabase.rpc("rbac_admin_users");
  if (error) throw error;
  return data ?? [];
}

export async function setUserRoles(userId, roles) {
  const { data, error } = await supabase.rpc("rbac_admin_set_user_roles", { p_user: userId, p_roles: roles });
  if (error) return { ok: false, message: friendly(error, "Could not save the roles. Please try again.") };
  return { ok: true, roles: data };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateNewUser(f) {
  const e = {};
  if (!String(f.full_name ?? "").trim()) e.full_name = "Enter the person's name.";
  if (!EMAIL.test(String(f.email ?? "").trim())) e.email = "Enter a valid sign-in email.";
  const pw = passwordProblem(f.password ?? "");
  if (pw) e.password = pw;
  if (!f.roles?.length) e.roles = "Choose at least one role.";
  return e;
}

export async function createUser(f) {
  const { data, error } = await supabase.rpc("rbac_admin_create_user", {
    p: { full_name: String(f.full_name).trim(), email: String(f.email).trim().toLowerCase(), password: f.password, roles: f.roles },
  });
  if (error) return { ok: false, message: friendly(error, "Could not add the user. Please try again.") };
  return { ok: true, userId: data };
}
