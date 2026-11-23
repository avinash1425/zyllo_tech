import { useState } from "react";
import { Megaphone } from "lucide-react";
import PageHeader from "../PageHeader";
import MessageComposer from "@/employee/MessageComposer";
import { SentList } from "@/employee/pages/NotificationsPage";

const CARD = "rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-[0_1px_2px_rgba(16,26,58,0.06)]";

/**
 * Admin: send a notification to everyone or to chosen employees (meetings,
 * urgent changes, announcements). Shows in their Employee Portal under
 * Notifications; urgent ones show as a red banner until read. Migration 235.
 */
export default function EmployeeMessagesPage() {
  const [sentKey, setSentKey] = useState(0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employee Messages"
        icon={Megaphone}
        subtitle="Send a message to all employees or to chosen people. It appears in their Employee Portal notifications; urgent messages show as a banner until they read them."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <section className={`${CARD} lg:col-span-3`}>
          <h2 className="mb-4 text-base font-bold text-[#2b303b]">New message</h2>
          <MessageComposer onSent={() => setSentKey((k) => k + 1)} />
        </section>
        <section className={`${CARD} lg:col-span-2`}>
          <h2 className="mb-2 text-base font-bold text-[#2b303b]">Sent (last 90 days)</h2>
          <SentList key={sentKey} />
        </section>
      </div>
    </div>
  );
}
