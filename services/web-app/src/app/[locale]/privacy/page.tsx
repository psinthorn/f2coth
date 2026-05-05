import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.privacy" });
  return { title: t("title") };
}

export default async function PrivacyPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");

  return (
    <section className="container-page py-16">
      <div className="prose-f2 mx-auto max-w-3xl">
        <h1 className="font-display text-4xl text-navy-900">{t("title")}</h1>
        <p>{t("lead")}</p>
        <h2>{t("collectTitle")}</h2>
        <p>{t("collectBody")}</p>
        <h2>{t("useTitle")}</h2>
        <p>{t("useBody")}</p>
        <h2>{t("contactTitle")}</h2>
        <p>{t("contactBody")}<a href="mailto:hello@f2.co.th">hello@f2.co.th</a>.</p>
      </div>
    </section>
  );
}
