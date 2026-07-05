import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { cms } from "@/lib/api";
import HostingClient from "./HostingClient";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";
import { FAQ } from "@/components/FAQ";
import type { FAQItem } from "@/lib/api";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "hosting.metadata" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/hosting"),
    ...pageOpenGraph({ locale, path: "/hosting", title, description }),
  };
}

export default async function HostingPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tCommon = await getTranslations("common");
  const tMeta = await getTranslations({ locale, namespace: "hosting.metadata" });
  const tHosting = await getTranslations({ locale, namespace: "hosting" });
  const plans = await cms.listHostingPlans(locale);
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: tMeta("title"), path: "/hosting" }],
    tCommon("home"),
  );
  const faqItems = tHosting.raw("faq.items") as FAQItem[];
  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <HostingClient plans={plans} />
      <FAQ items={faqItems} heading={tHosting("faq.heading")} />
    </>
  );
}
