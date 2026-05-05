import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { cms } from "@/lib/api";
import HostingClient from "./HostingClient";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "hosting.metadata" });
  return { title: t("title"), description: t("description") };
}

export default async function HostingPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const plans = await cms.listHostingPlans(locale);
  return <HostingClient plans={plans} />;
}
