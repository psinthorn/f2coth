"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, Eye, EyeOff } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { BilingualEditor, BilingualTextArea } from "@/components/admin/BilingualField";
import { adminApi, type AdminCaseStudy, type CaseStudyWriteInput } from "@/lib/admin-api";

interface Props {
  cs?: AdminCaseStudy;
}

export default function CaseStudyEditor({ cs }: Props) {
  const t = useTranslations("admin.caseStudies");
  const tc = useTranslations("common");
  const router = useRouter();

  const [slug, setSlug] = useState(cs?.slug ?? "");
  const [clientName, setClientName] = useState(cs?.client_name ?? "");
  const [industry, setIndustry] = useState(cs?.industry ?? "");
  const [location, setLocation] = useState(cs?.location ?? "");
  const [years, setYears] = useState(cs?.relationship_years ?? 0);
  const [hero, setHero] = useState(cs?.hero_image_url ?? "");

  const [summaryEN, setSummaryEN] = useState(cs?.summary.en ?? "");
  const [summaryTH, setSummaryTH] = useState(cs?.summary.th ?? "");
  const [challengeEN, setChallengeEN] = useState(cs?.challenge.en ?? "");
  const [challengeTH, setChallengeTH] = useState(cs?.challenge.th ?? "");
  const [solutionEN, setSolutionEN] = useState(cs?.solution.en ?? "");
  const [solutionTH, setSolutionTH] = useState(cs?.solution.th ?? "");
  const [resultsEN, setResultsEN] = useState(cs?.results.en ?? "");
  const [resultsTH, setResultsTH] = useState(cs?.results.th ?? "");
  const [quoteEN, setQuoteEN] = useState(cs?.quote_text.en ?? "");
  const [quoteTH, setQuoteTH] = useState(cs?.quote_text.th ?? "");
  const [quoteAuthor, setQuoteAuthor] = useState(cs?.quote_author ?? "");
  const [servicesRaw, setServicesRaw] = useState((cs?.services_used ?? []).join(", "));
  const [sortOrder, setSortOrder] = useState(cs?.sort_order ?? 0);
  const [isPublished, setIsPublished] = useState(cs?.is_published ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function autoSlug(str: string) {
    return str.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    const services_used = servicesRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const input: CaseStudyWriteInput = {
      slug: slug || autoSlug(clientName),
      client_name: clientName,
      industry,
      location: location || null,
      relationship_years: years || null,
      hero_image_url: hero || null,
      summary_en: summaryEN,
      summary_th: summaryTH,
      challenge_en: challengeEN,
      challenge_th: challengeTH,
      solution_en: solutionEN,
      solution_th: solutionTH,
      results_en: resultsEN,
      results_th: resultsTH,
      quote_text_en: quoteEN,
      quote_text_th: quoteTH,
      quote_author: quoteAuthor || null,
      services_used,
      sort_order: sortOrder,
      is_published: isPublished,
    };
    try {
      if (cs) {
        await adminApi.updateCaseStudy(cs.slug, input);
      } else {
        await adminApi.createCaseStudy(input);
      }
      router.push("/admin/case-studies" as any);
    } catch (e: any) {
      setError(e?.body ? JSON.parse(e.body)?.error ?? t("saveError") : t("saveError"));
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!cs) return;
    if (!confirm(t("deleteConfirm"))) return;
    setSaving(true);
    try {
      await adminApi.deleteCaseStudy(cs.slug);
      router.push("/admin/case-studies" as any);
    } catch {
      setError(t("deleteError"));
      setSaving(false);
    }
  }

  const isEditing = !!cs;

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">
            {isEditing ? t("editTitle") : t("newTitle")}
          </h1>
          {isEditing && <p className="mt-1 text-sm text-navy-500 font-mono">{cs.slug}</p>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <BilingualEditor className="lg:col-span-2 space-y-4">
          <BilingualTextArea label={t("field.summary")}   rows={3} en={summaryEN}   th={summaryTH}   onEN={setSummaryEN}   onTH={setSummaryTH} />
          <BilingualTextArea label={t("field.challenge")} rows={6} en={challengeEN} th={challengeTH} onEN={setChallengeEN} onTH={setChallengeTH} />
          <BilingualTextArea label={t("field.solution")}  rows={6} en={solutionEN}  th={solutionTH}  onEN={setSolutionEN}  onTH={setSolutionTH} />
          <BilingualTextArea label={t("field.results")}   rows={4} en={resultsEN}   th={resultsTH}   onEN={setResultsEN}   onTH={setResultsTH} />
          <BilingualTextArea label={t("field.quote")}     rows={3} en={quoteEN}     th={quoteTH}     onEN={setQuoteEN}     onTH={setQuoteTH} />

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.quoteAuthor")}</label>
            <input
              type="text"
              value={quoteAuthor}
              onChange={(e) => setQuoteAuthor(e.target.value)}
              className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
            />
          </div>
        </BilingualEditor>

        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="font-display text-lg text-navy-900">{t("section.settings")}</h2>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                {t("field.clientName")} <span aria-hidden>*</span>
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => {
                  setClientName(e.target.value);
                  if (!isEditing && !slug) setSlug(autoSlug(e.target.value));
                }}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                required
              />
            </div>
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
              <p className="mt-1 text-xs text-navy-400">/case-studies/{slug || "…"}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                {t("field.industry")} <span aria-hidden>*</span>
              </label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.location")}</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.years")}</label>
              <input
                type="number"
                value={years}
                onChange={(e) => setYears(parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.heroImageURL")}</label>
              <input
                type="url"
                value={hero}
                onChange={(e) => setHero(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">{t("field.servicesUsed")}</label>
              <input
                type="text"
                value={servicesRaw}
                onChange={(e) => setServicesRaw(e.target.value)}
                placeholder="it-management, cybersecurity, …"
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-navy-400">{t("field.servicesUsedHint")}</p>
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
                disabled={saving || !clientName || !slug || !industry}
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
                  {t("deleteCase")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
