import { useEffect, useState } from "react";

// Tiny data-loading hook that replaces server-component awaits.
// `fn` is an async function returning the data; re-runs when `deps` change.
// Returns { data, loading }. On a thrown error, data is null.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: undefined, loading: true });
  useEffect(() => {
    let active = true;
    setState((s) => (s.loading ? s : { data: s.data, loading: true }));
    Promise.resolve()
      .then(fn)
      .then((data) => active && setState({ data, loading: false }))
      .catch((err) => {
        console.error(err);
        if (active) setState({ data: null, loading: false });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
