// supabase-js is about a quarter of the startup JavaScript and the first paint
// does not need it, so code that runs on every page loads the client on demand.
// Route chunks that only load after startup can import ./client directly.
export const loadSupabase = () => import("./client").then((m) => m.supabase);
