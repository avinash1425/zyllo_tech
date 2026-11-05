// Leave types (policy) in HR Settings. Since migration 160 leave policies
// change only through the maker-checker workflow (propose -> a second HR
// user approves -> new policy version), shared with Leave Management's
// Policies tab. Types are never deleted; deactivate them instead.
import LeavePolicies from "@/hr/leave/LeavePolicies";

export default function LeaveTypesSettings({ canEdit }) {
  return <LeavePolicies canEdit={canEdit} />;
}
