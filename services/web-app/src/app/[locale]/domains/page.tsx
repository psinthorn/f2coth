import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { cms } from "@/lib/api";
import DomainsClient from "./DomainsClient";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "domains.metadata" });
  return { title: t("title"), description: t("description") };
}

export default async function DomainsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const pricing = await cms.listDomainPricing(locale);
  return <DomainsClient pricing={pricing} />;
}
