import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ChatWidget from "@/components/ChatWidget";
import { routing } from "@/i18n/routing";

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

  return (
    <NextIntlClientProvider>
      <Header />
      <main>{children}</main>
      <Footer />
      <ChatWidget />
    </NextIntlClientProvider>
  );
}
