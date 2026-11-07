// Optional "Performance" section for the employee profile (HR side). Not wired
// into EmployeeDetail.jsx; render <EmployeePerformanceSummary employeeId={id} />
// wherever a compact view is wanted. Visible only with performance access.
import { ExternalLink } from "lucide-react";
import Link from "@/lib/nx/link";
import { useAuth } from "@/hr/platform/auth";
import { Card } from "@/hr/ui";
import { EmployeePerformanceHistory } from "./HistoryTab";

const PERMS = ["performance.view", "performance.view_team", "performance.manage"];

export default function EmployeePerformanceSummary({ employeeId }) {
  const { hasPermission } = useAuth();
  if (!employeeId || !PERMS.some((p) => hasPermission(p))) return null;
  return (
    <Card title="Performance" actions={
      <Link href={`/hr/performance?tab=history&employee=${employeeId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#1f4693] hover:text-[#f96706]">
        Full history<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>}>
      <EmployeePerformanceHistory employeeId={employeeId} compact />
    </Card>
  );
}
