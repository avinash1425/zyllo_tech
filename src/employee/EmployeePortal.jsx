import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, Clock, Loader2, LogIn, LogOut, ShieldOff, Timer, UserX } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getIsAdmin, getMe, getMyAccess, punchIn, punchOut } from "@/lib/api/employee/attendance";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/portal/portalStyles";
import { dayName, formatDate, formatDateTime, todayIst } from "./attendanceFormat";
import EmployeeShell from "./EmployeeShell";
import ChangePasswordScreen from "./ChangePasswordScreen";
import AttendancePage from "./pages/AttendancePage";
import ProfilePage from "./pages/ProfilePage";
import MyProjectsPage from "./pages/MyProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import DailyReportPage from "./pages/DailyReportPage";
import { TeamReportDetailPage, TeamReportsPage } from "./pages/TeamReportsPage";
import LeavePage from "./pages/LeavePage";
import TeamLeavePage from "./pages/TeamLeavePage";
import DashboardPage from "./pages/DashboardPage";
import NotificationsPage from "./pages/NotificationsPage";
import { getNotificationSummary, markRead } from "@/lib/api/employee/notifications";
import { AccessProvider, useAccess } from "@/lib/access";

function FullScreen({ children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f6f7fb] p-4 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f7941e]/15 blur-[90px]" />
        <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[#1f4693]/15 blur-[90px]" />
      </div>
      <div className="relative w-full">{children}</div>
    </div>
  );
}

/** Centered spinner for the full-screen loading states. */
function LoadingScreen() {
  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-3 text-sm text-[#676b7a]" role="status">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-[0_8px_24px_-12px_rgba(16,26,58,0.25)] ring-1 ring-[#e7e9ee]">
          <Loader2 className="h-6 w-6 animate-spin text-[#1f4693]" aria-hidden="true" />
        </span>
        Loading…
      </div>
    </FullScreen>
  );
}

function NotEmployee({ onSignOut }) {
  // "disabled" = an employee whose portal access the admin turned off (migration 239);
  // "admin" = an admin account, which belongs on the admin side.
  const [access, setAccess] = useState(undefined);
  useEffect(() => {
    let active = true;
    Promise.all([getIsAdmin().catch(() => false), getMyAccess().catch(() => null)]).then(([admin, a]) => {
      if (active) setAccess(admin ? "admin" : a);
    });
    return () => {
      active = false;
    };
  }, []);
  if (access === undefined) return <LoadingScreen />;
  if (access === "admin") return <Navigate to="/admin" replace />;
  const disabled = access === "disabled";
  const Icon = disabled ? ShieldOff : UserX;
  return (
    <FullScreen>
      <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border border-[#e7e9ee] bg-white text-center shadow-[0_24px_60px_-24px_rgba(16,26,58,0.35)]">
        <div className="h-1.5 bg-gradient-to-r from-[#f7941e] via-[#f96706] to-[#1f4693]" aria-hidden="true" />
        <div className="flex flex-col items-center gap-4 px-6 pb-7 pt-8">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/10 text-[#1f4693] ring-1 ring-inset ring-[#1f4693]/10">
            <Icon className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[#101a3a]">
            {disabled ? "Portal access is turned off" : "Not an employee account"}
          </h1>
          <p className="text-sm leading-relaxed text-[#676b7a]">
            {disabled
              ? "Your Employee Portal access has been turned off by the admin. Please contact the admin if you think this is a mistake."
              : "This account does not have access to the Employee Portal."}
          </p>
          <button type="button" onClick={onSignOut} className={`${BTN_PRIMARY} mt-1 w-full`}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </FullScreen>
  );
}

/** Blocking pop-up: nothing else is usable until the employee punches in. */
function PunchInDialog({ me, busy, message, onPunchIn, onSignOut }) {
  const last = me.last_session;
  const today = todayIst().iso;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#0b1633]/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-punch-title"
        className="w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center shadow-[0_30px_80px_-20px_rgba(11,22,51,0.6)]"
      >
        {/* Gradient header strip (main dashboard hero colours) */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#3089a6] px-6 pb-12 pt-6 text-white">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-[#f7941e]/45 blur-[60px]" />
            <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-[#1f4693]/50 blur-[60px]" />
          </div>
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
            {dayName(today)}, {formatDate(today)}
          </p>
          <p className="relative mt-1 text-sm font-semibold text-white/90">Employee Portal</p>
        </div>
        <div className="relative -mt-9 flex justify-center">
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white shadow-[0_12px_24px_-8px_rgba(249,103,6,0.7)] ring-4 ring-white">
            <Clock size={34} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </div>

        <div className="px-6 pb-6 pt-4">
          <h1 id="ep-punch-title" className="text-2xl font-bold tracking-tight text-[#101a3a]">
            Hi {me.full_name}
          </h1>
          <p className="mt-1 text-sm text-[#676b7a]">Punch in to start your day.</p>
          {last?.auto_punched_out ? (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-left text-xs leading-relaxed text-violet-800">
              <Timer className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                You did not punch out last time, so you were punched out automatically at{" "}
                {formatDateTime(last.punch_out_at)}.
              </span>
            </p>
          ) : (
            last && (
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#f6f7fb] px-3 py-1 text-xs text-[#676b7a] ring-1 ring-inset ring-[#e7e9ee]">
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Last punch out: {formatDateTime(last.punch_out_at)}
              </p>
            )
          )}
          {message && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-left text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{message}</span>
            </p>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" autoFocus onClick={onPunchIn} disabled={busy} className={`${BTN_PRIMARY} w-full !py-3.5 !text-base`}>
              {busy ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <LogIn size={20} aria-hidden="true" />}
              {busy ? "Punching in…" : "Punch in"}
            </button>
            <button type="button" onClick={onSignOut} disabled={busy} className={`${BTN_SECONDARY} w-full`}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmployeePortal() {
  const { user, loading, signOut } = useAuth();
  const { pathname, search } = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  // Keyed by account so a different sign-in starts from a clean state.
  return (
    <AccessProvider userId={user.id}>
      <EmployeeArea key={user.id} userId={user.id} signOut={signOut} />
    </AccessProvider>
  );
}

/** A page that needs one of the permissions (the database checks every action again). */
function PortalGate({ perms, children }) {
  const { can } = useAccess();
  return perms.some((p) => can(p)) ? children : <Navigate to="/employee" replace />;
}

function EmployeeArea({ userId, signOut }) {
  const { loading: accessLoading, can } = useAccess();
  // undefined = loading, null = not an employee, object = employee
  const [me, setMe] = useState(undefined);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try {
      setMe(await getMe());
      setLoadError("");
    } catch {
      setLoadError("Could not load your details. Please refresh the page.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    getMe()
      .then((data) => active && setMe(data))
      .catch(() => active && setLoadError("Could not load your details. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [userId]);

  // A tab left open past the 8:00 PM cut-off: reload, and the database
  // punches the employee out automatically (migration 233).
  const autoOutAt = me?.open_session?.auto_punch_out_at;
  useEffect(() => {
    if (!autoOutAt) return undefined;
    const ms = new Date(autoOutAt).getTime() - Date.now() + 2000;
    // setTimeout cannot wait longer than ~24.8 days; a session never lasts that long.
    const id = setTimeout(refresh, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(id);
  }, [autoOutAt, refresh]);

  // Notification bell + urgent banner: checked on load, every minute, and
  // whenever the page changes (cheap RPC).
  const [summary, setSummary] = useState({ unread: 0, urgent: [] });
  const [summaryTick, setSummaryTick] = useState(0);
  const refreshSummary = useCallback(() => setSummaryTick((t) => t + 1), []);
  const punchedIn = !!me?.open_session;
  const { pathname: path, search } = useLocation();
  useEffect(() => {
    if (!punchedIn) return undefined;
    let active = true;
    const load = () =>
      getNotificationSummary()
        .then((s) => active && s && setSummary(s))
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [punchedIn, summaryTick, path]);

  async function dismissUrgent(id) {
    await markRead([id]).catch(() => {});
    refreshSummary();
  }

  async function onPunchIn() {
    setBusy(true);
    setMessage("");
    const result = await punchIn();
    if (!result.ok) setMessage(result.message);
    await refresh();
    setBusy(false);
  }

  async function onPunchOut() {
    setBusy(true);
    setMessage("");
    const result = await punchOut();
    if (!result.ok) setMessage(result.message);
    await refresh();
    setBusy(false);
  }

  const helmet = (
    <Helmet>
      <title>Employee Portal | Zyllo Tech</title>
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
  );

  if (loadError)
    return (
      <FullScreen>
        <p role="alert" className="mx-auto flex max-w-sm items-start gap-2 rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm text-red-700 shadow-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {loadError}
        </p>
      </FullScreen>
    );
  if (me === undefined || accessLoading) return <LoadingScreen />;
  if (me === null) return <NotEmployee onSignOut={signOut} />;
  // Signed in with the temporary password the admin gave: set an own password first (migration 249).
  if (me.must_change_password) return <ChangePasswordScreen me={me} signOut={signOut} />;

  return (
    <>
      {helmet}
      {/* Punch-in first, unless the role has no "Punch in / out" permission (Settings -> Roles & Permissions). */}
      {me.open_session || !can("emp.attendance.create") ? (
        <EmployeeShell
          me={me}
          busy={busy}
          message={message}
          onPunchOut={onPunchOut}
          onSignOut={signOut}
          summary={summary}
          onDismissUrgent={dismissUrgent}
        >
          <Routes>
            <Route index element={<DashboardPage me={me} onNotificationsChanged={refreshSummary} />} />
            <Route path="attendance" element={<PortalGate perms={["emp.attendance"]}><AttendancePage me={me} /></PortalGate>} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="projects" element={<PortalGate perms={["emp.projects"]}><MyProjectsPage /></PortalGate>} />
            <Route path="projects/:projectId" element={<PortalGate perms={["emp.projects"]}><ProjectDetailPage /></PortalGate>} />
            <Route path="reports" element={<PortalGate perms={["emp.reports"]}><DailyReportPage key={search} /></PortalGate>} />
            <Route path="leave" element={<PortalGate perms={["emp.leave","team.leave"]}><LeavePage /></PortalGate>} />
            {/* Team requests: the reporting manager's final decision after the admin approved (migration 255). */}
            <Route path="leave/team" element={<PortalGate perms={["team.leave"]}><TeamLeavePage /></PortalGate>} />
            <Route path="notifications" element={<NotificationsPage onChanged={refreshSummary} />} />
            <Route path="reports/team" element={<PortalGate perms={["team.reports"]}><TeamReportsPage /></PortalGate>} />
            <Route path="reports/team/:reportId" element={<PortalGate perms={["team.reports"]}><TeamReportDetailPage /></PortalGate>} />
            <Route path="*" element={<Navigate to="/employee" replace />} />
          </Routes>
        </EmployeeShell>
      ) : (
        <FullScreen>
          <PunchInDialog me={me} busy={busy} message={message} onPunchIn={onPunchIn} onSignOut={signOut} />
        </FullScreen>
      )}
    </>
  );
}
