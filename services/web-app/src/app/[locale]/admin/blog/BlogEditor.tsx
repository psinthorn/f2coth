"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, Eye, EyeOff } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminBlogPost, type BlogPostWriteInput } from "@/lib/admin-api";

interface Props {
  /** If provided, we're editing an existing post. If null, we're creating. */
  post?: AdminBlogPost;
}

export default function BlogEditor({ post }: Props) {
  const t = useTranslations("admin.blog");
  const tc = useTranslations("common");
  const router = useRouter();

  const [slug, setSlug] = useState(post?.slug ?? "");
  const [titleEN, setTitleEN] = useState(post?.title.en ?? "");
  const [titleTH, setTitleTH] = useState(post?.title.th ?? "");
  const [excerptEN, setExcerptEN] = useState(post?.excerpt.en ?? "");
  const [excerptTH, setExcerptTH] = useState(post?.excerpt.th ?? "");
  const [bodyEN, setBodyEN] = useState(post?.body_md.en ?? "");
  const [bodyTH, setBodyTH] = useState(post?.body_md.th ?? "");
  const [coverURL, setCoverURL] = useState(post?.cover_image_url ?? "");
  const [tagsRaw, setTagsRaw] = useState((post?.tags ?? []).join(", "));
  const [isPublished, setIsPublished] = useState(post?.is_published ?? false);
  const [locale, setLocale] = useState<"en" | "th">("en");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function autoSlug(title: string) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);
  }

  async function handleSave(publish: boolean) {
    setSaving(true);
    setError("");

    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    const input: BlogPostWriteInput = {
      slug: slug || autoSlug(titleEN),
      title_en: titleEN,
      title_th: titleTH,
      excerpt_en: excerptEN,
      excerpt_th: excerptTH,
      body_md_en: bodyEN,
      body_md_th: bodyTH,
      cover_image_url: coverURL || null,
      tags,
      is_published: publish,
    };

    try {
      if (post) {
        await adminApi.updateBlogPost(post.slug, input);
      } else {
        await adminApi.createBlogPost(input as Required<Pick<BlogPostWriteInput, "slug">> & BlogPostWriteInput);
      }
      router.push("/admin/blog" as any);
    } catch (e: any) {
      setError(e?.body ? JSON.parse(e.body)?.error ?? t("saveError") : t("saveError"));
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!post) return;
    if (!confirm(t("deleteConfirm"))) return;
    setSaving(true);
    try {
      await adminApi.deleteBlogPost(post.slug);
      router.push("/admin/blog" as any);
    } catch {
      setError(t("deleteError"));
      setSaving(false);
    }
  }

  const isEditing = !!post;

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">
            {isEditing ? t("editTitle") : t("newTitle")}
          </h1>
          {isEditing && (
            <p className="mt-1 text-sm text-navy-500 font-mono">{post.slug}</p>
          )}
        </div>
        {/* Locale toggle */}
        <div className="flex rounded-lg border border-navy-200 overflow-hidden shrink-0">
          {(["en", "th"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`px-4 py-1.5 text-sm ${
                locale === l
                  ? "bg-navy-900 text-white"
                  : "text-navy-600 hover:bg-navy-50"
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">
              {t("field.title")} ({locale.toUpperCase()}) <span aria-hidden>*</span>
            </label>
            {locale === "en" ? (
              <input
                type="text"
                value={titleEN}
                onChange={(e) => {
                  setTitleEN(e.target.value);
                  if (!isEditing && !slug) setSlug(autoSlug(e.target.value));
                }}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                required
              />
            ) : (
              <input
                type="text"
                value={titleTH}
                onChange={(e) => setTitleTH(e.target.value)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                placeholder={t("field.titleTHHint")}
              />
            )}
          </div>

          {/* Excerpt */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">
              {t("field.excerpt")} ({locale.toUpperCase()})
            </label>
            {locale === "en" ? (
              <textarea
                value={excerptEN}
                onChange={(e) => setExcerptEN(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            ) : (
              <textarea
                value={excerptTH}
                onChange={(e) => setExcerptTH(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            )}
          </div>

          {/* Body (Markdown) */}
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">
              {t("field.body")} ({locale.toUpperCase()}) — Markdown
            </label>
            {locale === "en" ? (
              <textarea
                value={bodyEN}
                onChange={(e) => setBodyEN(e.target.value)}
                rows={20}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm font-mono focus:border-accent-500 focus:outline-none"
                placeholder="# Heading&#10;&#10;Your content here…"
              />
            ) : (
              <textarea
                value={bodyTH}
                onChange={(e) => setBodyTH(e.target.value)}
                rows={20}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm font-mono focus:border-accent-500 focus:outline-none"
                placeholder="# หัวข้อ&#10;&#10;เนื้อหาที่นี่…"
              />
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="font-display text-lg text-navy-900">{t("section.settings")}</h2>

            {/* Slug */}
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                {t("field.slug")} <span aria-hidden>*</span>
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm font-mono focus:border-accent-500 focus:outline-none"
                placeholder="my-post-slug"
              />
              <p className="mt-1 text-xs text-navy-400">/blog/{slug || "…"}</p>
            </div>

            {/* Cover image */}
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                {t("field.coverImageURL")}
              </label>
              <input
                type="url"
                value={coverURL}
                onChange={(e) => setCoverURL(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                {t("field.tags")}
              </label>
              <input
                type="text"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="hospitality, microsoft-365"
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-navy-400">{t("field.tagsHint")}</p>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-2 text-sm">
              {isPublished ? (
                <Eye className="h-4 w-4 text-emerald-600" />
              ) : (
                <EyeOff className="h-4 w-4 text-amber-600" />
              )}
              <span className={isPublished ? "text-emerald-700" : "text-amber-700"}>
                {isPublished ? t("status.published") : t("status.draft")}
              </span>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2 border-t border-navy-100">
              <button
                onClick={() => handleSave(true)}
                disabled={saving || !titleEN}
                className="btn-accent w-full disabled:opacity-60"
              >
                {saving ? <><Loader2 className="inline h-4 w-4 animate-spin mr-1" />{tc("saving")}</> : t("savePublish")}
              </button>
              <button
                onClick={() => handleSave(false)}
                disabled={saving || !titleEN}
                className="btn-primary w-full disabled:opacity-60"
              >
                {t("saveDraft")}
              </button>
              {isEditing && (
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {t("deletePost")}
                </button>
              )}
            </div>
          </div>

          {/* Completeness */}
          <div className="card text-sm text-navy-600">
            <p className="font-medium text-navy-900 mb-2">{t("section.completeness")}</p>
            <CheckRow label="EN title" done={!!titleEN} />
            <CheckRow label="EN excerpt" done={!!excerptEN} />
            <CheckRow label="EN body" done={!!bodyEN} />
            <CheckRow label="TH title" done={!!titleTH} />
            <CheckRow label="TH excerpt" done={!!excerptTH} />
            <CheckRow label="TH body" done={!!bodyTH} />
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
