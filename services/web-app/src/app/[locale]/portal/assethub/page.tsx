"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Download, Lock, Search } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { assethubPortal, type AssetDevice, type AssetOverview } from "@/lib/assethub-api";

export default function PortalAssetHubPage() {
  const t = useTranslations("portal.assethub");
  const [overview, setOverview] = useState<AssetOverview | null>(null);
  const [devices, setDevices] = useState<AssetDevice[] | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    Promise.all([
      assethubPortal.overview().catch((e: any) => { if (e?.status === 404) setForbidden(true); return null; }),
      assethubPortal.listDevices().catch(() => [] as AssetDevice[]),
    ]).then(([o, d]) => {
      setOverview(o);
      setDevices(d ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!devices) return [];
    const term = q.toLowerCase().trim();
    if (!term) return devices;
    return devices.filter((d) =>
      [d.hostname, d.model, d.primary_ip, d.serial_number, d.os_name].some((v) => v?.toLowerCase().includes(term)));
  }, [devices, q]);

  return (
    <PortalShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {loading ? <Loader2 className="h-5 w-5 animate-spin text-navy-400" /> : forbidden ? (
        <div className="rounded-lg border border-navy-100 bg-navy-50 p-8 text-center">
          <Lock className="mx-auto mb-3 h-6 w-6 text-navy-400" />
          <p className="text-navy-600">{t("locked")}</p>
        </div>
      ) : (
        <>
          {overview && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label={t("stat.total")} value={overview.total} />
              <Tile label={t("stat.computers")} value={overview.by_type.filter((b) => ["computer", "server"].includes(b.label)).reduce((a, b) => a + b.count, 0)} />
              <Tile label={t("stat.network")} value={overview.by_type.filter((b) => ["router", "switch", "ap", "printer", "nas", "camera"].includes(b.label)).reduce((a, b) => a + b.count, 0)} />
              <Tile label={t("stat.new30")} value={overview.new_30d} />
            </div>
          )}

          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-navy-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="w-full rounded-lg border border-navy-200 py-2 pl-8 pr-3 text-sm" />
            </div>
            <button onClick={() => assethubPortal.exportCSV()} className="btn-ghost text-sm">
              <Download className="mr-1 inline h-4 w-4" />{t("csv")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-navy-100">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-xs uppercase text-navy-500">
                <tr>
                  <th className="px-3 py-2 text-left">{t("col.host")}</th>
                  <th className="px-3 py-2 text-left">{t("col.type")}</th>
                  <th className="px-3 py-2 text-left">{t("col.model")}</th>
                  <th className="px-3 py-2 text-left">{t("col.os")}</th>
                  <th className="px-3 py-2 text-left">{t("col.ip")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {filtered.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 font-medium text-navy-900">{d.hostname || d.primary_ip || d.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">{d.device_type}</td>
                    <td className="px-3 py-2 text-navy-600">{[d.brand, d.model].filter(Boolean).join(" ")}</td>
                    <td className="px-3 py-2 text-navy-600">{[d.os_name, d.os_version].filter(Boolean).join(" ")}</td>
                    <td className="px-3 py-2 text-navy-500">{d.primary_ip}</td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-navy-400">{t("empty")}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PortalShell>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-navy-500">{label}</p>
      <p className="mt-1 font-display text-3xl text-navy-900">{value}</p>
    </div>
  );
}
