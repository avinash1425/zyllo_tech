import { createServerSupabaseClient } from "@/lib/supabase/server";
import PortfolioManager from "./PortfolioManager";

async function getProjects() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("portfolio_projects")
    .select("id, title, tag, description, image_url, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load portfolio projects:", error.message);
    return [];
  }

  return data ?? [];
}

export default async function AdminPortfolioPage() {
  const projects = await getProjects();
  return <PortfolioManager initialProjects={projects} />;
}
