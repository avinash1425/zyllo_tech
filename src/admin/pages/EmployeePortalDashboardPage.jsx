import { UsersRound } from "lucide-react";
import PageHeader from "../PageHeader";

/**
 * Admin: Employee Portal — dashboard. Intentionally empty for now
 * (2026-11-23); the admin tools for the Employee Portal will be added here.
 */
export default function EmployeePortalDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Employee Portal" icon={UsersRound} subtitle="Dashboard" />
    </div>
  );
}
