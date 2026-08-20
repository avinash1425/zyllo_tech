import { useEffect, useState } from "react";

// Client-side replacement for the server components' `await getX()` calls.
// Returns `fallback` until the promise resolves, so the ported sections keep
// their original render bodies untouched.
export function useAsyncData(loader, fallback) {
  const [data, setData] = useState(fallback);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => loader())
      .then((result) => {
        if (!cancelled && result !== undefined && result !== null) setData(result);
      })
      .catch((error) => {
        console.error("Failed to load data:", error?.message || error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return data;
}

export default useAsyncData;
