import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { cms } from "@/lib/api";
import DomainsClient from "./DomainsClient";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "domains.metadata" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/domains"),
    ...pageOpenGraph({ locale, path: "/domains", title, description }),
  };
}

export default async function DomainsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tCommon = await getTranslations("common");
  const tMeta = await getTranslations({ locale, namespace: "domains.metadata" });
  const pricing = await cms.listDomainPricing(locale);
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: tMeta("title"), path: "/domains" }],
    tCommon("home"),
  );
  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <DomainsClient pricing={pricing} />
    </>
  );
}
