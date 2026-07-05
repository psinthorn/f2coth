import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import ConditionalChrome from "@/components/ConditionalChrome";
import AppModeBanner from "@/components/AppModeBanner";
import MaintenanceSplash from "@/components/MaintenanceSplash";
import { routing } from "@/i18n/routing";
import { getEnabledModulesRecord } from "@/lib/modules";
import { getAppMode } from "@/lib/appMode";
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

  // Fetch the enabled-modules map + app mode server-side. React.cache dedups
  // both with any child that asks again during the same render.
  const [enabledModules, appMode] = await Promise.all([
    getEnabledModulesRecord(),
    getAppMode(locale),
  ]);

  // Maintenance mode blocks the public site and customer portal so no traffic
  // reaches the running app. Admin routes bypass the block so operators can
  // still flip the switch back — detected via the x-pathname header stamped
  // by middleware. (Same header we use in the root layout for locale.)
  const path = (await headers()).get("x-pathname") ?? "";
  const isAdminRoute = /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(path);
  if (appMode.mode === "maintenance" && !isAdminRoute) {
    return (
      <NextIntlClientProvider>
        <MaintenanceSplash locale={locale} />
      </NextIntlClientProvider>
    );
  }

  return (
    <NextIntlClientProvider>
      {/* Site-wide JSON-LD — Organization, LocalBusiness, WebSite. Emitted
          from the root layout so every page inherits the same entity
          identity (LLMs / Knowledge Graph dedupe by exact match). See
          lib/schema.tsx and docs/seo-specs.md §12. */}
      <JsonLd data={organization()} />
      <JsonLd data={localBusiness()} />
      <JsonLd data={webSite()} />

      {/* Global app-mode banner: silent in production, shows a coloured
          strip on trial / maintenance. Rendered above chrome so it's the
          first thing every visitor and staff member sees. */}
      <AppModeBanner locale={locale} />

      <ConditionalChrome locale={locale} enabledModules={enabledModules}>
        {children}
      </ConditionalChrome>
    </NextIntlClientProvider>
  );
}
