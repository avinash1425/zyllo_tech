import { useParams } from "@/lib/nx/navigation";
import NotFound from "@/pages/NotFound";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import ApplicantsManager from "../careers/applicants/ApplicantsManager";
import { fetchJobWithApplicants } from "@/lib/api/admin/careers";

export default function AdminJobApplicantsPage() {
  const { id } = useParams();
  const { data, loading } = useAdminData(() => fetchJobWithApplicants(id), [id]);
  if (loading) return <AdminLoading />;
  if (!data) return <NotFound />;
  return (
    <ApplicantsManager
      key={id}
      job={data.job}
      initialApplicants={data.applicants}
    />
  );
}
