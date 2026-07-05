"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import { Link } from "@/i18n/routing";
import { portalApi, type PortalSandboxStatus } from "@/lib/portal-api";

// Top-of-page banner shown across portal + admin while ANY payment
// method is in sandbox mode. Lists the affected methods so an admin
// can tell at a glance which one is still in test mode. Fetches status
// once per page load and stops rendering when no method is sandbox.
// Failures are silent — the banner is informational, not load-bearing.
export default function SandboxBanner({ adminCTA = false }: { adminCTA?: boolean }) {
  const t = useTranslations("payments.sandbox");
  const tm = useTranslations("admin.paymentMethods.labels");
  const [status, setStatus] = useState<PortalSandboxStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .sandboxStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { /* silent — banner just won't show */ });
    return () => { cancelled = true; };
  }, []);

  if (!status?.any_sandbox) return null;

  const sandboxMethods = Object.entries(status.methods)
    .filter(([, mode]) => mode === "sandbox")
    .map(([method]) => method);
  const methodLabels = sandboxMethods.map((m) => {
    try { return tm(m as never); } catch { return m; }
  }).join(", ");

  return (
    <div className="w-full bg-amber-100 border-b border-amber-200 px-4 py-2 text-amber-900">
      <div className="container-page flex items-center justify-between gap-3 text-xs sm:text-sm">
        <p className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0" />
          <span>
            <strong>{t("badge")}</strong> ·{" "}
            {t("methodsInSandbox", { count: sandboxMethods.length, methods: methodLabels })}
          </span>
        </p>
        {adminCTA && (
          <Link
            href={"/admin/payments/sandbox" as never}
            className="rounded-md bg-amber-200 px-2 py-1 font-medium hover:bg-amber-300 whitespace-nowrap"
          >
            {t("openDashboard")}
          </Link>
        )}
      </div>
    </div>
  );
}
