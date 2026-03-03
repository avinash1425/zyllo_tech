import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 900);
      return () => clearTimeout(timer);
    }
  }, []);

  const setConsent = (value: "accepted" | "declined") => {
    localStorage.setItem("cookie-consent", value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <section
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto w-auto max-w-3xl rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-background/80 md:inset-x-6"
      aria-label="Cookie consent"
      role="dialog"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Cookie preferences</p>
            <p className="text-xs text-muted-foreground">
              We use essential and analytics cookies to improve your experience.
            </p>
            <a
              href="/contact"
              className="mt-1 inline-block text-xs text-primary underline underline-offset-2"
            >
              Cookie policy
            </a>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setConsent("declined")}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => setConsent("accepted")}
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Accept
          </button>
        </div>
      </div>
    </section>
  );
};

export default CookieConsent;
