// Signed-in account without any HR / employee / admin access.
import Seo from "@/hr/platform/Seo";
import Link from "@/hr/platform/link";
import { useAuth } from "@/hr/platform/auth";
import { accountLabelFor } from "@/hr/platform/account";

export default function AccountPending() {
  const { user, hr, signOut } = useAuth();
  // Employee ID accounts: show the Employee ID, never the internal login address.
  const who = accountLabelFor({ user, hr });
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb] px-4">
      <Seo title="No portal access" noindex />
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-extrabold text-[#101a3a]">No portal access yet</h1>
        <p className="mt-2 text-sm text-slate-600">{who ? `${who} is signed in, but` : "This account"} is not linked to an active employee record or role. Contact Zyllo Tech HR.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-[#173a52] hover:bg-slate-50">Public website</Link>
          {user && <button type="button" onClick={signOut} className="rounded-xl bg-[#101a3a] px-4 py-2 text-sm font-semibold text-white">Sign out</button>}
        </div>
      </div>
    </div>
  );
}
