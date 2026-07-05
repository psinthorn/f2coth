"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, Eye, EyeOff, ExternalLink } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { BilingualEditor, BilingualInput, BilingualTextArea } from "@/components/admin/BilingualField";
import { adminApi, type AdminPage, type PageWriteInput } from "@/lib/admin-api";

interface Props {
  page?: AdminPage;
}

const RESERVED_SLUGS = new Set([
  "admin", "portal", "api", "services", "case-studies", "products",
  "domains", "hosting", "blog", "contact",
]);

export default function PageEditor({ page }: Props) {
  const t = useTranslations("admin.pages");
  const tc = useTranslations("common");
  const router = useRouter();

  const [slug, setSlug] = useState(page?.slug ?? "");
  const [titleEN, setTitleEN] = useState(page?.title.en ?? "");
  const [titleTH, setTitleTH] = useState(page?.title.th ?? "");
  const [bodyEN, setBodyEN] = useState(page?.body_md.en ?? "");
  const [bodyTH, setBodyTH] = useState(page?.body_md.th ?? "");
  const [seoTitleEN, setSeoTitleEN] = useState(page?.seo_title.en ?? "");
  const [seoTitleTH, setSeoTitleTH] = useState(page?.seo_title.th ?? "");
  const [seoDescEN, setSeoDescEN] = useState(page?.seo_description.en ?? "");
  const [seoDescTH, setSeoDescTH] = useState(page?.seo_description.th ?? "");
  const [isPublished, setIsPublished] = useState(page?.is_published ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function autoSlug(title: string) {
    return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    const input: PageWriteInput = {
      slug: slug || autoSlug(titleEN),
      title_en: titleEN,
      title_th: titleTH,
      body_md_en: bodyEN,
      body_md_th: bodyTH,
      seo_title_en: seoTitleEN,
      seo_title_th: seoTitleTH,
      seo_description_en: seoDescEN,
      seo_description_th: seoDescTH,
      is_published: isPublished,
    };
    try {
      if (page) {
        await adminApi.updatePage(page.slug, input);
      } else {
        await adminApi.createPage(input);
      }
      router.push("/admin/pages" as any);
    } catch (e: any) {
      setError(e?.body ? JSON.parse(e.body)?.error ?? t("saveError") : t("saveError"));
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!page) return;
    if (!confirm(t("deleteConfirm"))) return;
    setSaving(true);
    try {
      await adminApi.deletePage(page.slug);
      router.push("/admin/pages" as any);
    } catch {
      setError(t("deleteError"));
      setSaving(false);
    }
  }

  const isEditing = !!page;
  const slugConflict = !isEditing && slug && RESERVED_SLUGS.has(slug);

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">
            {isEditing ? t("editTitle") : t("newTitle")}
          </h1>
          {isEditing && (
            <div className="mt-1 flex items-center gap-3 text-sm text-navy-500">
              <span className="font-mono">/{page.slug}</span>
              <a
                href={`/${page.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-accent-700"
              >
                {t("viewLive")} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
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
            label={`${t("field.body")} — Markdown`}
            rows={24}
            mono
            placeholderEN={"# Heading\n\nYour content here…"}
            placeholderTH={"# หัวข้อ\n\nเนื้อหาที่นี่…"}
            helper={t("field.bodyHint")}
            en={bodyEN}
            th={bodyTH}
            onEN={setBodyEN}
            onTH={setBodyTH}
          />

          <details className="rounded-lg border border-navy-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-navy-700">
              {t("section.seo")}
            </summary>
            <div className="mt-4 space-y-3">
              <BilingualInput
                label={t("field.seoTitle")}
                maxLength={70}
                en={seoTitleEN}
                th={seoTitleTH}
                onEN={setSeoTitleEN}
                onTH={setSeoTitleTH}
              />
              <BilingualTextArea
                label={t("field.seoDescription")}
                rows={2}
                maxLength={200}
                en={seoDescEN}
                th={seoDescTH}
                onEN={setSeoDescEN}
                onTH={setSeoDescTH}
              />
            </div>
          </details>
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
                disabled={isEditing}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm font-mono focus:border-accent-500 focus:outline-none disabled:bg-navy-50 disabled:text-navy-500"
              />
              <p className="mt-1 text-xs text-navy-400">/{slug || "…"}</p>
              {slugConflict && (
                <p className="mt-1 text-xs text-red-600">{t("field.slugReserved")}</p>
              )}
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
                disabled={saving || !titleEN || !slug || !!slugConflict}
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
                  {t("deletePage")}
                </button>
              )}
            </div>
          </div>

          <div className="card text-sm text-navy-600">
            <p className="font-medium text-navy-900 mb-2">{t("section.completeness")}</p>
            <CheckRow label="EN title" done={!!titleEN} />
            <CheckRow label="EN body" done={!!bodyEN} />
            <CheckRow label="TH title" done={!!titleTH} />
            <CheckRow label="TH body" done={!!bodyTH} />
            <CheckRow label="EN SEO title" done={!!seoTitleEN} />
            <CheckRow label="EN SEO description" done={!!seoDescEN} />
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

function CheckRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${done ? "text-emerald-700" : "text-navy-400"}`}>
      <span>{done ? "✓" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}
