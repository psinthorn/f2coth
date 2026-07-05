import { getTranslations } from "next-intl/server";
import { Wrench, Mail } from "lucide-react";
import { getAppMode } from "@/lib/appMode";

// Full-viewport maintenance screen shown to public + portal visitors while
// mode === maintenance. Admin routes bypass this in the layout gate so
// operators can still turn the site back on. Rendered as children of the
// root layout (which owns <html> + <body>), so this returns a plain section.
export default async function MaintenanceSplash({ locale }: { locale: string }) {
  const [{ message }, t] = await Promise.all([
    getAppMode(locale),
    getTranslations({ locale, namespace: "appMode" }),
  ]);

  return (
    <main className="grid min-h-screen place-items-center bg-navy-900 px-6 text-white">
      <div className="max-w-xl text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10">
          <Wrench className="h-8 w-8 text-accent-300" />
        </div>
        <h1 className="mt-6 font-display text-4xl sm:text-5xl">
          {t("splashTitle")}
        </h1>
        <p className="mt-4 text-navy-200">
          {message || t("maintenanceDefault")}
        </p>
        <a
          href="mailto:hello@f2.co.th"
          className="mt-8 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
        >
          <Mail className="h-4 w-4" /> hello@f2.co.th
        </a>
      </div>
    </main>
  );
}
