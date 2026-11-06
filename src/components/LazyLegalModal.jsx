import { lazy, Suspense, useEffect, useState } from "react";

const LegalModal = lazy(() => import("@/components/LegalModal"));

// Footer and cookie banner are on every page, but the modal (and framer-motion
// with it) is only needed once opened. It stays mounted afterwards so its close
// animation still runs.
export default function LazyLegalModal(props) {
  const [opened, setOpened] = useState(props.isOpen);
  useEffect(() => {
    if (props.isOpen) setOpened(true);
  }, [props.isOpen]);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <LegalModal {...props} />
    </Suspense>
  );
}
