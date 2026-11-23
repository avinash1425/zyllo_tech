import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { LogIn, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMe, punchIn, punchOut } from "@/lib/api/employee/attendance";
import { formatDateTime } from "./attendanceFormat";
import EmployeeShell from "./EmployeeShell";
import AttendancePage from "./pages/AttendancePage";
import ProfilePage from "./pages/ProfilePage";
import MyProjectsPage from "./pages/MyProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import DailyReportPage from "./pages/DailyReportPage";
import { TeamReportDetailPage, TeamReportsPage } from "./pages/TeamReportsPage";
import LeavePage from "./pages/LeavePage";
import DashboardPage from "./pages/DashboardPage";
import NotificationsPage from "./pages/NotificationsPage";
import { getNotificationSummary, markRead } from "@/lib/api/employee/notifications";

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white`;
const BTN_SECONDARY = `${BTN} border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]`;

function FullScreen({ children }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb] p-4 sm:p-8">{children}</div>;
}

function NotEmployee({ onSignOut }) {
  return (
    <FullScreen>
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Not an employee account</h1>
        <p className="text-sm text-[#676b7a]">This account does not have access to the Employee Portal.</p>
        <button type="button" onClick={onSignOut} className={BTN_PRIMARY}>
          Sign out
        </button>
      </div>
    </FullScreen>
  );
}

/** Blocking pop-up: nothing else is usable until the employee punches in. */
function PunchInDialog({ me, busy, message, onPunchIn, onSignOut }) {
  const last = me.last_session;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1633]/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-punch-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f0f4ff] text-[#1f4693]">
          <Clock size={24} aria-hidden="true" />
        </div>
        <h1 id="ep-punch-title" className="mt-4 text-xl font-bold text-[#2b303b]">
          Hi {me.full_name}
        </h1>
        <p className="mt-1 text-sm text-[#676b7a]">Punch in to start your day.</p>
        {last?.auto_punched_out ? (
          <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
            You did not punch out last time, so you were punched out automatically at{" "}
            {formatDateTime(last.punch_out_at)}.
          </p>
        ) : (
          last && <p className="mt-3 text-xs text-[#9aa0ad]">Last punch out: {formatDateTime(last.punch_out_at)}</p>
        )}
        {message && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {message}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <button type="button" autoFocus onClick={onPunchIn} disabled={busy} className={BTN_PRIMARY}>
            <LogIn size={16} aria-hidden="true" />
            {busy ? "Punching in…" : "Punch in"}
          </button>
          <button type="button" onClick={onSignOut} disabled={busy} className={BTN_SECONDARY}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EmployeePortal() {
  const { user, loading, signOut } = useAuth();
  const { pathname, search } = useLocation();
  if (loading) return <FullScreen><p className="text-sm text-[#676b7a]">Loading…</p></FullScreen>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  // Keyed by account so a different sign-in starts from a clean state.
  return <EmployeeArea key={user.id} userId={user.id} signOut={signOut} />;
}

function EmployeeArea({ userId, signOut }) {
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

  // A tab left open past the 10:00 PM cut-off: reload, and the database
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

  if (loadError) return <FullScreen><p role="alert" className="text-sm text-red-700">{loadError}</p></FullScreen>;
  if (me === undefined) return <FullScreen><p className="text-sm text-[#676b7a]">Loading…</p></FullScreen>;
  if (me === null) return <NotEmployee onSignOut={signOut} />;

  return (
    <>
      {helmet}
      {me.open_session ? (
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
            <Route path="attendance" element={<AttendancePage me={me} />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="projects" element={<MyProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="reports" element={<DailyReportPage key={search} />} />
            <Route path="leave" element={<LeavePage />} />
            {/* "Team requests" hidden for now (2026-11-23); old links land on Leave Management. */}
            <Route path="leave/team" element={<Navigate to="/employee/leave" replace />} />
            <Route path="notifications" element={<NotificationsPage onChanged={refreshSummary} />} />
            <Route path="reports/team" element={<TeamReportsPage />} />
            <Route path="reports/team/:reportId" element={<TeamReportDetailPage />} />
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
