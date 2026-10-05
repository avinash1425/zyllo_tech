import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import BlogManager from "../blog/BlogManager";
import { fetchBlogPosts } from "@/lib/api/admin/blog";

export default function AdminBlogPage() {
  const { data, loading, reload } = useAdminData(fetchBlogPosts);
  if (loading || !data) return <AdminLoading />;
  return <BlogManager initialPosts={data} onReload={reload} />;
}
