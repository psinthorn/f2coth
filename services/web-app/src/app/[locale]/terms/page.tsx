import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.terms" });
  return { title: t("title") };
}

export default async function TermsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("terms");

  return (
    <section className="container-page py-16">
      <div className="prose-f2 mx-auto max-w-3xl">
        <h1 className="font-display text-4xl text-navy-900">{t("title")}</h1>
        <p>{t("body")}</p>
      </div>
    </section>
  );
}
