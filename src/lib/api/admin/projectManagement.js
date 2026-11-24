// Admin: Project Management for the Employee Portal (migration 241).
// Projects are the Project Tracker's projects; teams and tasks are the
// Employee Portal's. All calls are admin-only RPCs (public.is_admin()).
import { supabase } from "@/lib/supabase/client";

export const ACTIVE_STATUSES = ["planning", "in_progress", "live", "on_hold"];
export const DONE_STATUSES = ["completed", "cancelled"];

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  if (/Only admins|not found|not on the project|active employee|active member|title is required|deadline cannot be/i.test(msg)) return msg;
  if (/title_check/.test(msg)) return "Task title must be 1 to 200 characters.";
  if (/description/.test(msg)) return "Description must be up to 2000 characters.";
  if (/due_date/.test(msg)) return "Choose a valid deadline.";
  if (/project_role/.test(msg)) return "Role must be up to 60 characters.";
  if (/end_date/.test(msg)) return "Choose a valid deadline.";
  return fallback;
}

async function call(fn, args, fallback) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: friendly(error, fallback) };
  return { ok: true, project: data };
}

export async function listProjects() {
  const { data, error } = await supabase.rpc("ep_admin_pm_projects");
  if (error) throw error;
  return data ?? [];
}

export async function getProject(id) {
  const { data, error } = await supabase.rpc("ep_admin_pm_project", { p_project: id });
  if (error) throw error;
  return data;
}

export const saveMember = (projectId, employeeId, role, isLead) =>
  call(
    "ep_admin_pm_save_member",
    { p_project: projectId, p_employee: employeeId, p_role: role ?? "", p_is_lead: !!isLead },
    "Could not save the team member.",
  );

export const removeMember = (projectId, employeeId) =>
  call("ep_admin_pm_remove_member", { p_project: projectId, p_employee: employeeId }, "Could not remove the team member.");

export function validateTask(t) {
  const errors = {};
  const title = String(t.title ?? "").trim();
  if (!title) errors.title = "Title is required.";
  else if (title.length > 200) errors.title = "Keep it under 200 characters.";
  if (String(t.description ?? "").length > 2000) errors.description = "Keep it under 2000 characters.";
  return errors;
}

export const saveTask = (projectId, taskId, t) =>
  call(
    "ep_admin_pm_save_task",
    {
      p_project: projectId,
      p_task: taskId ?? null,
      p: {
        title: String(t.title ?? "").trim(),
        description: String(t.description ?? "").trim(),
        assignee_id: t.assignee_id ?? "",
        priority: t.priority || "medium",
        status: t.status || "todo",
        due_date: t.due_date ?? "",
      },
    },
    "Could not save the task.",
  );

export const deleteTask = (taskId) => call("ep_admin_pm_delete_task", { p_task: taskId }, "Could not delete the task.");

export const setDeadline = (projectId, date) =>
  call("ep_admin_pm_set_deadline", { p_project: projectId, p_date: date || null }, "Could not save the deadline.");

/** Task completion % (0 when there are no tasks). */
export const pct = (done, total) => (Number(total) > 0 ? Math.round((Number(done) / Number(total)) * 100) : 0);
