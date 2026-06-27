import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Mail, MapPin, Clock } from "lucide-react";
import { cms } from "@/lib/api";
import ContactForm from "./ContactForm";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.contact" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/contact"),
    ...pageOpenGraph({ locale, path: "/contact", title, description }),
  };
}

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ service?: string; module?: string }>;
};

export default async function ContactPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");
  const tCommon = await getTranslations("common");

  const { service, module } = await searchParams;
  const services = await cms.listServices(locale);
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: t("title"), path: "/contact" }],
    tCommon("home"),
  );

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <section className="bg-navy-50">
        <div className="container-page py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("kicker")}</p>
          <h1 className="mt-2 font-display text-4xl text-navy-900 sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-2xl text-navy-600">
            {t("subtitle")}
            <a className="text-accent-700 hover:text-accent-900" href="mailto:hello@f2.co.th">
              hello@f2.co.th
            </a>
            .
          </p>
        </div>
      </section>

      <section className="container-page py-16 grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ContactForm
            services={services}
            preselectedService={service}
            preselectedModule={module}
          />
        </div>

        <aside className="space-y-4">
          <div className="card">
            <Mail className="h-5 w-5 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("side.email")}</h3>
            <a className="mt-1 block text-sm text-navy-600 hover:text-accent-700" href="mailto:hello@f2.co.th">
              hello@f2.co.th
            </a>
          </div>
          <div className="card">
            <MapPin className="h-5 w-5 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("side.offices")}</h3>
            <p className="mt-1 text-sm text-navy-600">{t("side.officesValue")}</p>
          </div>
          <div className="card">
            <Clock className="h-5 w-5 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("side.responseTime")}</h3>
            <p className="mt-1 text-sm text-navy-600">{t("side.responseTimeValue")}</p>
          </div>
        </aside>
      </section>
    </>
  );
}
