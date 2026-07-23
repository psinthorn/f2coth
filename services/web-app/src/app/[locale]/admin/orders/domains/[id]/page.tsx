"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Save, Info, Send, AlertTriangle } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
import { adminApi, type AdminDomainOrder, type DomainOrderStatus } from "@/lib/admin-api";

const STATUSES: DomainOrderStatus[] = [
  "pending", "quoted", "approved", "registered", "active", "rejected", "cancelled", "failed",
];

export default function AdminDomainOrderDetailPage() {
  const t = useTranslations("admin.orders");
  const td = useTranslations("admin.orders.detail");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [order, setOrder] = useState<AdminDomainOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const [status, setStatus] = useState<DomainOrderStatus>("pending");
  const [registryOrderID, setRegistryOrderID] = useState("");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placeConfirm, setPlaceConfirm] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const o = await adminApi.getDomainOrder(id);
      setOrder(o);
      setStatus(o.status);
      setRegistryOrderID(o.registry_order_id ?? "");
      setNotes(o.notes ?? "");
    } catch (e: any) {
      setErr(e?.body ?? e?.message ?? "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function save() {
    if (!id || busy) return;
    setBusy(true);
    setSaved(false);
    setErr("");
    try {
      await adminApi.updateDomainOrder(id, {
        status,
        registry_order_id: registryOrderID,
        notes,
      });
      setSaved(true);
      toast.success(tc("toast.saved"));
      load();
    } catch (e: any) {
      const msg = e?.body ?? e?.message ?? "error";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function place() {
    if (!id || placing) return;
    setPlacing(true);
    setErr("");
    try {
      const updated = await adminApi.placeDomainOrder(id);
      setOrder(updated);
      setStatus(updated.status);
      setRegistryOrderID(updated.registry_order_id ?? "");
      setPlaceConfirm(false);
      toast.success(tc("toast.done"));
    } catch (e: any) {
      // The 502 error path includes both the message and the updated order;
      // fall back to a string body for non-JSON failures.
      let msg = "";
      try {
        const parsed = JSON.parse(e?.body ?? "{}");
        msg = parsed.error ?? e?.body ?? e?.message ?? "error";
        if (parsed.order) setOrder(parsed.order);
      } catch {
        msg = e?.body ?? e?.message ?? "error";
      }
      setErr(msg);
      toast.error(msg);
    } finally {
      setPlacing(false);
    }
  }

  const canPlace =
    !!order &&
    !order.registry_order_id &&
    (order.status === "pending" || order.status === "approved");

  return (
    <AdminShell>
      <Link href="/admin/orders/domains" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {td("back")}
      </Link>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : !order ? (
        <div className="mt-6 card text-navy-500">{tc("notFound")}</div>
      ) : (
        <>
          <header className="mt-4 mb-6">
            <h1 className="font-display text-2xl text-navy-900">{order.fqdn}</h1>
            <p className="mt-1 text-sm text-navy-500">
              {order.registry} · {new Date(order.created_at).toLocaleString()}
            </p>
          </header>

          {err && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</div>}

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 card space-y-2 text-sm">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{td("registrant")}</h3>
              <Row label="Name" value={order.contact_name ?? "—"} />
              <Row label="Email" value={order.contact_email ?? "—"} />
              <Row label="Phone" value={order.contact_phone ?? "—"} />
              <Row label="Company" value={order.contact_company ?? "—"} />
              <Row label="Years" value={order.years.toString()} />
              <Row label="Privacy" value={order.privacy_enabled ? "✓" : "—"} />
              {order.customer_id && <Row label="Customer ID" value={order.customer_id} />}
              {order.lead_id && <Row label="Lead ID" value={order.lead_id} />}
            </section>

            <aside className="card space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{td("manage")}</h3>
              <select value={status} onChange={(e) => setStatus(e.target.value as DomainOrderStatus)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm">
                {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
              </select>
              <div>
                <label className="text-xs text-navy-700">{td("registryOrderId")}</label>
                <input
                  type="text"
                  value={registryOrderID}
                  onChange={(e) => setRegistryOrderID(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
                />
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder={td("noteAddPlaceholder")}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
              />
              <button onClick={save} disabled={busy} className="btn-accent w-full justify-center">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {tc("saving")}</> : <><Save className="h-4 w-4" /> {td("save")}</>}
              </button>
              {saved && <p className="text-xs text-emerald-700">{td("saved")}</p>}

              {canPlace && (
                <div className="border-t border-navy-100 pt-3">
                  {!placeConfirm ? (
                    <button
                      onClick={() => setPlaceConfirm(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
                    >
                      <Send className="h-4 w-4" /> {td("placeButton")}
                    </button>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="flex items-start gap-2 text-xs text-emerald-900">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{td("placeConfirm", { fqdn: order!.fqdn, years: order!.years })}</span>
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPlaceConfirm(false)}
                          disabled={placing}
                          className="flex-1 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs text-navy-700 hover:bg-navy-50"
                        >
                          {tc("cancel")}
                        </button>
                        <button
                          onClick={place}
                          disabled={placing}
                          className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {placing ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : td("placeConfirmYes")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{td("modeNoticeMock")}</span>
              </p>
            </aside>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-navy-50 py-1.5 last:border-b-0">
      <span className="text-xs text-navy-500">{label}</span>
      <span className="text-navy-900">{value}</span>
    </div>
  );
}
