"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, Eye, EyeOff } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { BilingualEditor, BilingualInput, BilingualTextArea } from "@/components/admin/BilingualField";
import { toast } from "@/lib/toast";
import { adminApi, type AdminService, type ServiceWriteInput } from "@/lib/admin-api";

interface Props {
  service?: AdminService;
}

export default function ServiceEditor({ service }: Props) {
  const t = useTranslations("admin.services");
  const tc = useTranslations("common");
  const router = useRouter();

  const [slug, setSlug] = useState(service?.slug ?? "");
  const [titleEN, setTitleEN] = useState(service?.title.en ?? "");
  const [titleTH, setTitleTH] = useState(service?.title.th ?? "");
  const [summaryEN, setSummaryEN] = useState(service?.short_summary.en ?? "");
  const [summaryTH, setSummaryTH] = useState(service?.short_summary.th ?? "");
  const [descEN, setDescEN] = useState(service?.description.en ?? "");
  const [descTH, setDescTH] = useState(service?.description.th ?? "");
  const [icon, setIcon] = useState(service?.icon ?? "");
  const [category, setCategory] = useState<AdminService["category"]>(service?.category ?? "core");
  const [sortOrder, setSortOrder] = useState(service?.sort_order ?? 0);
  const [isPublished, setIsPublished] = useState(service?.is_published ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function autoSlug(title: string) {
    return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError("");
    const input: ServiceWriteInput = {
      slug: slug || autoSlug(titleEN),
      title_en: titleEN,
      title_th: titleTH,
      short_summary_en: summaryEN,
      short_summary_th: summaryTH,
      description_en: descEN,
      description_th: descTH,
      icon: icon || null,
      category,
      sort_order: sortOrder,
      is_published: isPublished,
    };
    try {
      if (service) {
        await adminApi.updateService(service.slug, input);
      } else {
        await adminApi.createService(input);
      }
      toast.success(tc("toast.saved"));
      router.push("/admin/services" as any);
    } catch (e: any) {
      const msg = e?.body ? JSON.parse(e.body)?.error ?? t("saveError") : t("saveError");
      setError(msg);
      toast.error(msg);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!service) return;
    if (!confirm(t("deleteConfirm"))) return;
    if (saving) return;
    setSaving(true);
    try {
      await adminApi.deleteService(service.slug);
      toast.success(tc("toast.deleted"));
      router.push("/admin/services" as any);
    } catch {
      const msg = t("deleteError");
      setError(msg);
      toast.error(msg);
      setSaving(false);
    }
  }

  const isEditing = !!service;

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">
            {isEditing ? t("editTitle") : t("newTitle")}
          </h1>
          {isEditing && <p className="mt-1 text-sm text-navy-500 font-mono">{service.slug}</p>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <BilingualEditor className="lg:col-span-2 space-y-4">
          <BilingualInput
            label={t("field.title")}
            required
            en={titleEN}
            th={titleTH}
            onEN={(v) => {
              setTitleEN(v);
              if (!isEditing && !slug) setSlug(autoSlug(v));
            }}
            onTH={setTitleTH}
          />
          <BilingualTextArea
            label={t("field.shortSummary")}
            rows={2}
            maxLength={300}
            en={summaryEN}
            th={summaryTH}
            onEN={setSummaryEN}
            onTH={setSummaryTH}
          />
          <BilingualTextArea
            label={t("field.description")}
            rows={12}
            en={descEN}
            th={descTH}
            onEN={setDescEN}
            onTH={setDescTH}
          />
        </BilingualEditor>

        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="font-display text-lg text-navy-900">{t("section.settings")}</h2>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                {t("field.slug")} <span aria-hidden>*</span>
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm font-mono focus:border-accent-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-navy-400">/services/{slug || "…"}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.icon")}</label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="server, cloud, shield-check…"
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm font-mono focus:border-accent-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-navy-400">{t("field.iconHint")}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.category")}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AdminService["category"])}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              >
                <option value="core">core</option>
                <option value="support">support</option>
                <option value="marketing">marketing</option>
                <option value="opportunistic">opportunistic</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.sortOrder")}</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                {isPublished ? (
                  <Eye className="h-4 w-4 text-emerald-600" />
                ) : (
                  <EyeOff className="h-4 w-4 text-amber-600" />
                )}
                {isPublished ? t("status.published") : t("status.draft")}
              </span>
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex flex-col gap-2 pt-2 border-t border-navy-100">
              <button
                onClick={handleSave}
                disabled={saving || !titleEN || !slug}
                className="btn-accent w-full disabled:opacity-60"
              >
                {saving ? (
                  <>
                    <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                    {tc("saving")}
                  </>
                ) : (
                  tc("save")
                )}
              </button>
              {isEditing && (
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {t("deleteService")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
