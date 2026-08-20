import { useCallback, useState } from "react";

// React 18 has no useActionState / form `action` prop, so the ported forms
// call this instead: it receives the submit event, builds FormData, and runs
// the same (prevState, formData) => nextState function the Next.js version used.
export function useActionState(action, initialState) {
  const [state, setState] = useState(initialState);
  const [isPending, setIsPending] = useState(false);

  const formAction = useCallback(
    async (event) => {
      if (event?.preventDefault) event.preventDefault();
      const form = event?.currentTarget ?? event?.target;
      const formData =
        typeof FormData !== "undefined" && form instanceof HTMLFormElement
          ? new FormData(form)
          : event;

      setIsPending(true);
      try {
        const next = await action(state, formData);
        setState(next);
        if (next?.status === "success" && form instanceof HTMLFormElement) {
          form.reset();
        }
      } catch (error) {
        setState({ status: "error", message: "Something went wrong. Please try again." });
        console.error("Form submission failed:", error?.message || error);
      } finally {
        setIsPending(false);
      }
    },
    [action, state],
  );

  return [state, formAction, isPending];
}

export default useActionState;
