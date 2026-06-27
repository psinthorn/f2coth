import type { Metadata } from "next";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy.confirm" });
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  };
}

type Status = "verified" | "expired" | "invalid";

function normaliseStatus(v: string | string[] | undefined): Status {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "verified" || s === "expired" ? s : "invalid";
}

export default async function PrivacyConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: rawStatus } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("privacy.confirm");

  const status = normaliseStatus(rawStatus);
  const isVerified = status === "verified";

  return (
    <section className="container-page py-24">
      <div className="mx-auto max-w-xl text-center">
        <div
          className={`mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full ${
            isVerified ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
          aria-hidden="true"
        >
          <span className="text-3xl">{isVerified ? "✓" : "!"}</span>
        </div>

        <h1 className="font-display text-3xl text-navy-900 mt-6">
          {t(`${status}Title`)}
        </h1>
        <p className="text-slate-600 mt-3">{t(`${status}Body`)}</p>

        <div className="mt-8 flex justify-center gap-3">
          <Link href={`/${locale}/privacy`} className="btn-accent">
            {t("backToPrivacy")}
          </Link>
          {!isVerified && (
            <Link href={`/${locale}/privacy#dsr`} className="btn-outline">
              {t("tryAgain")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
