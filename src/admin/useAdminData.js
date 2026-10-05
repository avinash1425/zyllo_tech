import { useCallback, useEffect, useRef, useState } from "react";

// Client-side replacement for server-component data fetching in admin pages.
// - `loading` is true only until the first load finishes (reloads keep the
//   previous data on screen so filters/scroll are preserved).
// - `reload()` refetches and resolves when done (replaces revalidatePath /
//   router.refresh()). It also fires on the `nx:refresh` window event that
//   the router shim's router.refresh() dispatches.
export default function useAdminData(loader, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const result = await loaderRef.current();
      if (id === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      console.error("Admin data load failed:", e?.message || e);
      if (id === seq.current) setError(e);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const handler = () => reload();
    window.addEventListener("nx:refresh", handler);
    return () => window.removeEventListener("nx:refresh", handler);
  }, [reload]);

  return { data, loading, error, reload };
}
