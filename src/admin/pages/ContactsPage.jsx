import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import ContactsManager from "../contacts/ContactsManager";
import { fetchSubmissions } from "@/lib/api/admin/contacts";

export default function AdminContactsPage() {
  const { data, loading } = useAdminData(fetchSubmissions);
  if (loading || !data) return <AdminLoading />;
  return <ContactsManager initialSubmissions={data} />;
}
