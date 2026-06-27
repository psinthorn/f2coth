import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import ConditionalChrome from "@/components/ConditionalChrome";
import { routing } from "@/i18n/routing";
import { getEnabledModulesRecord } from "@/lib/modules";
import { JsonLd, organization, localBusiness, webSite } from "@/lib/schema";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";
  return {
    title: { default: t("home.title"), template: t("titleTemplate") },
    description: t("home.description"),
    keywords: t("keywords").split(",").map((s) => s.trim()),
    alternates: {
      languages: {
        en: `${baseUrl}/`,
        th: `${baseUrl}/th/`,
        "x-default": `${baseUrl}/`,
      },
    },
    openGraph: {
      type: "website",
      locale: locale === "th" ? "th_TH" : "en_TH",
      siteName: t("siteName"),
    },
  };
}

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // Fetch the enabled-modules map server-side and pass it down to the chrome
  // so Header / Footer can hide links for disabled sections without flashing
  // them first. React.cache dedups this with any page that also calls
  // isModuleEnabled() during the same render.
  const enabledModules = await getEnabledModulesRecord();

  return (
    <NextIntlClientProvider>
      {/* Site-wide JSON-LD — Organization, LocalBusiness, WebSite. Emitted
          from the root layout so every page inherits the same entity
          identity (LLMs / Knowledge Graph dedupe by exact match). See
          lib/schema.tsx and docs/seo-specs.md §12. */}
      <JsonLd data={organization()} />
      <JsonLd data={localBusiness()} />
      <JsonLd data={webSite()} />

      <ConditionalChrome locale={locale} enabledModules={enabledModules}>
        {children}
      </ConditionalChrome>
    </NextIntlClientProvider>
  );
}
