"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, Eye, EyeOff } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { BilingualEditor, BilingualInput, BilingualTextArea } from "@/components/admin/BilingualField";
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
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content column */}
        <BilingualEditor className="lg:col-span-2 space-y-4">
          <BilingualInput
            label={t("field.title")}
            required
            placeholderTH={t("field.titleTHHint")}
            en={titleEN}
            th={titleTH}
            onEN={(v) => {
              setTitleEN(v);
              if (!isEditing && !slug) setSlug(autoSlug(v));
            }}
            onTH={setTitleTH}
          />
          <BilingualTextArea
            label={t("field.excerpt")}
            rows={3}
            maxLength={500}
            en={excerptEN}
            th={excerptTH}
            onEN={setExcerptEN}
            onTH={setExcerptTH}
          />
          <BilingualTextArea
            label={`${t("field.body")} — Markdown`}
            rows={20}
            mono
            placeholderEN={"# Heading\n\nYour content here…"}
            placeholderTH={"# หัวข้อ\n\nเนื้อหาที่นี่…"}
            en={bodyEN}
            th={bodyTH}
            onEN={setBodyEN}
            onTH={setBodyTH}
          />
        </BilingualEditor>

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
