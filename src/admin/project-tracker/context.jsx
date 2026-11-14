import { createContext, useContext } from "react";
import useLoad from "./useLoad";
import { listRecords } from "@/lib/api/admin/projectTracker";

// Role of the signed-in user inside Project Tracker ("viewer" | "editor" | "manager").
export const RoleContext = createContext({ role: null, canEdit: false, isManager: false, email: null, settings: null });
export const useRole = () => useContext(RoleContext);

// Per-project context for the detail workspace.
export const ProjectContext = createContext(null);
export const useProject = () => useContext(ProjectContext);

const REF_TABLES = {
  hosting: "pt_hosting",
  domains: "pt_domains",
  access: "pt_access_records",
  emails: "pt_email_accounts",
  repositories: "pt_repositories",
  milestones: "pt_milestones",
  tasks: "pt_tasks",
  documents: "pt_documents",
  amc: "pt_amc_contracts",
};

/** Records of the same project that forms can link to (dropdowns). Only this project's rows are ever loaded. */
export function useProjectRefs(projectId) {
  const { data, reload } = useLoad(async () => {
    if (!projectId) return { projectId, refs: {} };
    const entries = await Promise.all(
      Object.entries(REF_TABLES).map(async ([k, t]) => {
        try {
          return [k, await listRecords(t, projectId)];
        } catch {
          return [k, []];
        }
      }),
    );
    return { projectId, refs: Object.fromEntries(entries) };
  }, [projectId ?? null]);
  // Never hand out another project's records while switching projects.
  const refs = data && data.projectId === projectId ? data.refs : {};
  return { refs, reloadRefs: reload };
}
