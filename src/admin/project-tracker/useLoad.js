import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Load async data for the current `deps` (primitives only).
 * - `data` keeps the previous result while a new load runs (no flicker);
 *   `loading` is true until the result for the current deps arrives.
 * - `reload()` refetches with the same deps.
 * State is only set from promise callbacks, never synchronously in an effect.
 */
export default function useLoad(fn, deps) {
  const [version, setVersion] = useState(0);
  const key = JSON.stringify([...deps, version]);
  const [state, setState] = useState({ key: null, data: undefined, error: null });
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => fnRef.current())
      .then(
        (data) => { if (active) setState({ key, data, error: null }); },
        (error) => { if (active) setState((s) => ({ key, data: s.data, error })); },
      );
    return () => { active = false; };
  }, [key]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}
