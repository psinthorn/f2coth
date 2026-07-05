import { getTranslations } from "next-intl/server";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { getAppMode } from "@/lib/appMode";

// Global app-mode banner. Renders at the top of every non-production
// context (public site, portal shell, admin shell) so both customers and
// staff know the platform state. Silent when mode === production.
//
// Rendered as a server component so it participates in the same request
// cache as other CMS fetches — no client-side flash while it loads.
export default async function AppModeBanner({ locale }: { locale: string }) {
  const [snapshot, t] = await Promise.all([
    getAppMode(locale),
    getTranslations({ locale, namespace: "appMode" }),
  ]);

  if (snapshot.mode === "production") return null;

  const isMaint = snapshot.mode === "maintenance";
  const Icon = isMaint ? AlertTriangle : FlaskConical;
  const label = isMaint ? t("maintenance") : t("trial");
  const defaultBody = isMaint ? t("maintenanceDefault") : t("trialDefault");

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        isMaint
          ? "border-b border-red-300 bg-red-600 text-white"
          : "border-b border-amber-300 bg-amber-500 text-white"
      }
    >
      <div className="container-page flex items-start gap-3 py-2.5 text-sm">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <span className="font-semibold uppercase tracking-wider text-xs">{label}</span>
          <span className="mx-2 opacity-70">·</span>
          <span>{snapshot.message || defaultBody}</span>
        </div>
      </div>
    </div>
  );
}
