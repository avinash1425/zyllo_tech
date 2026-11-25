import { CircleUserRound } from "lucide-react";
import PageHeader from "../PageHeader";
import { useAuth } from "@/lib/auth";
import { useAccess } from "@/lib/access";
import { formatDateTime } from "@/employee/attendanceFormat";
import { Avatar, Badge, Detail, Panel } from "@/components/portal/PortalUI";
import ChangePasswordCard from "@/components/portal/ChangePasswordCard";

/** Admin top-right menu -> My profile: my account details and "Change password" (migration 263). */
export default function MyProfilePage() {
  const { user } = useAuth();
  const { access } = useAccess();
  const name = user?.user_metadata?.full_name || (user?.email ?? "").split("@")[0];
  const myRoles = access?.roles ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My profile" icon={CircleUserRound} subtitle="Your account and password." />
      <Panel icon={CircleUserRound} title="Account details">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={name} size="h-14 w-14 text-lg" />
          <dl className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Name">{name || "—"}</Detail>
            <Detail label="Sign-in ID">
              <span className="break-all">{user?.email ?? "—"}</span>
            </Detail>
            <Detail label={myRoles.length > 1 ? "Roles" : "Role"}>
              {myRoles.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {myRoles.map((r) => (
                    <Badge key={r.key} tone={r.key === "super_admin" ? "orange" : "blue"}>{r.name}</Badge>
                  ))}
                </span>
              ) : (
                "—"
              )}
            </Detail>
            <Detail label="Last sign-in">{user?.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : "—"}</Detail>
          </dl>
        </div>
      </Panel>
      <ChangePasswordCard />
    </div>
  );
}
