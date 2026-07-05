import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Mail, MapPin, Clock } from "lucide-react";
import { F2_ORG } from "@/lib/schema";
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
            <a className="text-accent-700 hover:text-accent-900" href="mailto:info@f2.co.th">
              info@f2.co.th
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
            <a className="mt-1 block text-sm text-navy-600 hover:text-accent-700" href="mailto:info@f2.co.th">
              info@f2.co.th
            </a>
          </div>
          <div className="card">
            <MapPin className="h-5 w-5 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("side.offices")}</h3>
            <p className="mt-1 text-sm text-navy-600">{t("side.officesValue")}</p>
            <p className="mt-3 text-xs text-navy-500">{F2_ORG.street}, {F2_ORG.locality}, {F2_ORG.region} {F2_ORG.postalCode}</p>
            <a
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent-700 hover:text-accent-900"
              href={mapDirectionsURL()}
              target="_blank"
              rel="noreferrer"
            >
              {t("side.directions")}
            </a>
          </div>
          <div className="card">
            <Clock className="h-5 w-5 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("side.responseTime")}</h3>
            <p className="mt-1 text-sm text-navy-600">{t("side.responseTimeValue")}</p>
          </div>
        </aside>
      </section>

      {/* Embedded map — lazy-loaded iframe so it doesn't hurt LCP.
          Uses Google Maps' zero-config embed URL (no API key required).
          The visible text address above stays as the accessible fallback
          so screen readers and print-friendly views don't lose the NAP. */}
      <section className="container-page pb-16">
        <h2 className="sr-only">{t("side.mapHeading")}</h2>
        <div className="overflow-hidden rounded-xl border border-navy-100 shadow-sm">
          <iframe
            title={t("side.mapHeading")}
            src={mapEmbedURL()}
            className="h-[360px] w-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </section>
    </>
  );
}

/** Zero-config Google Maps embed pointing at F2's Bophut office. */
function mapEmbedURL(): string {
  const q = encodeURIComponent(
    `${F2_ORG.street}, ${F2_ORG.locality}, ${F2_ORG.region} ${F2_ORG.postalCode}, Thailand`,
  );
  return `https://maps.google.com/maps?q=${q}&z=15&hl=en&output=embed`;
}

/** Directions link that opens the caller's default Maps app. */
function mapDirectionsURL(): string {
  const q = encodeURIComponent(
    `${F2_ORG.street}, ${F2_ORG.locality}, ${F2_ORG.region} ${F2_ORG.postalCode}, Thailand`,
  );
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
