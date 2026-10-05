import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import JobApplicationsManager from "../job-applications/JobApplicationsManager";
import { fetchJobApplicationsPageData } from "@/lib/api/admin/careers";

export default function AdminJobApplicationsPage() {
  const { data, loading, reload } = useAdminData(fetchJobApplicationsPageData);
  if (loading || !data) return <AdminLoading />;
  return (
    <JobApplicationsManager
      initialApplications={data.applications}
      jobOptions={data.jobOptions}
      resumeFiles={data.resumeFiles}
      onReload={reload}
    />
  );
}
