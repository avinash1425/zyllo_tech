// Search Console data comes from the admin-only "search-console" Edge Function
// (currently clearly-labelled sample data, isSampleData: true).
// Request: { range: "7d" | "28d" | "3m" | "12m" }
import { supabase } from "@/lib/supabase/client";

export async function getSearchConsolePerformance(range) {
  const { data, error } = await supabase.functions.invoke("search-console", {
    body: { range },
  });
  if (error) throw error;
  return data;
}
