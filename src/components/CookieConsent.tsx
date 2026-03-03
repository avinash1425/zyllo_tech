import { useEffect, useState } from "react";
import { Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

type ConsentMode = "accepted" | "declined" | "custom";

interface CookiePreferences {
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
}

const defaultPreferences: CookiePreferences = {
  essential: true,
  analytics: true,
  marketing: false,
};

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences>(defaultPreferences);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent") as ConsentMode | null;
    const savedPrefs = localStorage.getItem("cookie-preferences");

    if (savedPrefs) {
      try {
        const parsed = JSON.parse(savedPrefs) as CookiePreferences;
        setPrefs({
          essential: true,
          analytics: !!parsed.analytics,
          marketing: !!parsed.marketing,
        });
      } catch {
        setPrefs(defaultPreferences);
      }
    }

    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 900);
      return () => clearTimeout(timer);
    }
  }, []);

  const saveConsent = (value: ConsentMode, preferences: CookiePreferences) => {
    localStorage.setItem("cookie-consent", value);
    localStorage.setItem("cookie-preferences", JSON.stringify(preferences));
    setVisible(false);
  };

  const acceptAll = () => {
    const updated = { essential: true, analytics: true, marketing: true };
    setPrefs(updated);
    saveConsent("accepted", updated);
  };

  const rejectAll = () => {
    const updated = { essential: true, analytics: false, marketing: false };
    setPrefs(updated);
    saveConsent("declined", updated);
  };

  const saveCustom = () => {
    saveConsent("custom", { ...prefs, essential: true });
  };

  const togglePreference = (key: "analytics" | "marketing") => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto w-auto max-w-3xl rounded-xl bg-gradient-to-r from-[hsl(24,95%,50%)] via-primary to-[hsl(195,55%,42%)] p-[1px] shadow-xl md:inset-x-6">
      <section
        className="rounded-xl bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        aria-label="Cookie consent"
        role="dialog"
        aria-live="polite"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Cookie preferences</p>
              <p className="text-xs text-muted-foreground">
                Manage which cookies you allow. Essential cookies are always enabled.
              </p>
              <Link
                to="/cookie-policy"
                className="mt-1 inline-block text-xs text-primary underline underline-offset-2"
              >
                Cookie policy
              </Link>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => setSettingsOpen((prev) => !prev)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted transition-colors"
              aria-expanded={settingsOpen}
              aria-controls="cookie-settings-panel"
              aria-label="Cookie settings"
              title="Cookie settings"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={rejectAll}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Reject
            </button>
            <button
              onClick={acceptAll}
              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Accept All
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div id="cookie-settings-panel" className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-md bg-background px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-foreground">Essential Cookies</p>
                  <p className="text-[11px] text-muted-foreground">Required for core site functionality.</p>
                </div>
                <span className="rounded-full bg-primary/15 px-2 py-1 text-[10px] font-semibold text-primary">
                  Always On
                </span>
              </div>

              <button
                type="button"
                onClick={() => togglePreference("analytics")}
                className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left"
              >
                <div>
                  <p className="text-xs font-semibold text-foreground">Analytics Cookies</p>
                  <p className="text-[11px] text-muted-foreground">Help us understand product usage and improve UX.</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${prefs.analytics ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {prefs.analytics ? "Allowed" : "Blocked"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => togglePreference("marketing")}
                className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left"
              >
                <div>
                  <p className="text-xs font-semibold text-foreground">Marketing Cookies</p>
                  <p className="text-[11px] text-muted-foreground">Used for campaign and personalization measurement.</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${prefs.marketing ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {prefs.marketing ? "Allowed" : "Blocked"}
                </span>
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={saveCustom}
                className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Save Settings
              </button>
              <button
                onClick={acceptAll}
                className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Allow All
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default CookieConsent;
