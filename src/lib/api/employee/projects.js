// Employee Portal: My Projects (migration 232).
// Projects come from the Project Tracker, but employees only get the safe
// fields of projects they are on, through security-definer RPCs.
import { supabase } from "@/lib/supabase/client";

export const PROJECT_STATUS = {
  planning: { label: "Planning", chip: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In progress", chip: "bg-sky-100 text-sky-800" },
  live: { label: "Live", chip: "bg-emerald-100 text-emerald-800" },
  on_hold: { label: "On hold", chip: "bg-amber-100 text-amber-800" },
  completed: { label: "Completed", chip: "bg-violet-100 text-violet-800" },
  cancelled: { label: "Cancelled", chip: "bg-red-100 text-red-700" },
};

export const HEALTH = {
  on_track: { label: "On track", chip: "bg-emerald-50 text-emerald-700" },
  at_risk: { label: "At risk", chip: "bg-amber-50 text-amber-700" },
  off_track: { label: "Off track", chip: "bg-red-50 text-red-700" },
};

export const PRIORITY = {
  high: { label: "High", chip: "bg-red-50 text-red-700" },
  medium: { label: "Medium", chip: "bg-amber-50 text-amber-700" },
  low: { label: "Low", chip: "bg-slate-100 text-slate-600" },
};

export const TASK_STATUS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  if (/not on this project|assignee must be on the project team|Not an active employee|past its deadline|reason|not late|not missed its deadline/i.test(msg)) return msg;
  if (/title_check/.test(msg)) return "Task title must be 1 to 200 characters.";
  if (/due_date/.test(msg)) return "Choose a valid deadline.";
  if (/body_check/.test(msg)) return "Update must be 1 to 2000 characters.";
  return fallback;
}

export async function getMyProjects() {
  const { data, error } = await supabase.rpc("ep_my_projects");
  if (error) throw error;
  return data ?? [];
}

export async function getProjectDetail(projectId) {
  const { data, error } = await supabase.rpc("ep_project_detail", { p_project: projectId });
  if (error) throw error;
  return data;
}

export function validateTask(t) {
  const errors = {};
  const title = String(t.title ?? "").trim();
  if (!title) errors.title = "Task title is required.";
  else if (title.length > 200) errors.title = "Keep it under 200 characters.";
  if (String(t.description ?? "").length > 2000) errors.description = "Keep it under 2000 characters.";
  if (t.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(t.due_date)) errors.due_date = "Choose a valid deadline.";
  return errors;
}

export async function addTask(projectId, t) {
  const { error } = await supabase.rpc("ep_add_task", {
    p_project: projectId,
    p_title: String(t.title ?? "").trim(),
    p_description: String(t.description ?? "").trim(),
    p_assignee: t.assignee_id || null,
    p_due_date: t.due_date || null,
    p_priority: t.priority || "medium",
  });
  if (error) return { ok: false, message: friendly(error, "Could not add the task. Please try again.") };
  return { ok: true };
}

/**
 * Change a task status. Marking a task Done after its deadline needs a reason
 * (migration 244): then { ok: false, needReason: true } comes back.
 */
export async function setTaskStatus(taskId, status, delayReason = null) {
  const { error } = await supabase.rpc("ep_set_task_status", {
    p_task: taskId,
    p_status: status,
    p_delay_reason: delayReason ? String(delayReason).trim() : null,
  });
  if (error) {
    return {
      ok: false,
      needReason: /past its deadline/i.test(error.message ?? ""),
      message: friendly(error, "Could not update the task. Please try again."),
    };
  }
  return { ok: true };
}

/** Why a task is late (only once it is past its deadline). */
export async function setTaskDelayReason(taskId, reason) {
  const { error } = await supabase.rpc("ep_set_task_delay_reason", { p_task: taskId, p_reason: String(reason ?? "").trim() });
  if (error) return { ok: false, message: friendly(error, "Could not save the reason. Please try again.") };
  return { ok: true };
}

/** Why the project missed its deadline (one per team member per deadline; can be edited). */
export async function setProjectDelayReason(projectId, reason) {
  const { error } = await supabase.rpc("ep_set_project_delay_reason", { p_project: projectId, p_reason: String(reason ?? "").trim() });
  if (error) return { ok: false, message: friendly(error, "Could not save the reason. Please try again.") };
  return { ok: true };
}

export async function postUpdate(projectId, body) {
  const text = String(body ?? "").trim();
  if (!text) return { ok: false, message: "Write something first." };
  if (text.length > 2000) return { ok: false, message: "Update must be 1 to 2000 characters." };
  const { error } = await supabase.rpc("ep_post_update", { p_project: projectId, p_body: text });
  if (error) return { ok: false, message: friendly(error, "Could not post the update. Please try again.") };
  return { ok: true };
}

/** Dashboard: my open tasks across my projects (overdue first). → { total, items } */
export async function getMyOpenTasks(limit = 5) {
  const { data, error } = await supabase.rpc("ep_my_open_tasks", { p_limit: limit });
  if (error) throw error;
  return data ?? { total: 0, items: [] };
}
