// Employee Portal — My Interviews: interviews where the employee sits on the
// panel (RLS shows only those). Lets non-HR interviewers submit feedback.
import { PageHeader } from "@/hr/ui";
import { InterviewsTab } from "@/hr/pages/RecruitmentPage";

export default function MyInterviewsPage() {
  return (
    <>
      <PageHeader title="My interviews" description="Candidates you are interviewing. Save your evaluation as a draft at any time; it can be submitted from the scheduled start time and is locked once submitted." />
      <InterviewsTab openApplications={false} />
    </>
  );
}
