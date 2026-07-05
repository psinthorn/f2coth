import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Building2 } from "lucide-react";
import Image from "next/image";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { isModuleEnabled } from "@/lib/modules";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";

// Module gate — this page is off by default (see migration 046). Runs
// first so a disabled module short-circuits before we hit cms-api.
async function requireModule() {
  if (!(await isModuleEnabled("public.clients"))) notFound();
}

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  await requireModule();
  const t = await getTranslations({ locale, namespace: "metadata.clients" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/clients"),
    ...pageOpenGraph({ locale, path: "/clients", title, description }),
  };
}

export default async function ClientsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireModule();
  setRequestLocale(locale);

  const t = await getTranslations("clients");
  const tc = await getTranslations("common");
  const clients = await cms.listPublicClients(locale);

  const kicker = t("kicker");
  const title = t("title");
  const subtitle = t("subtitle");
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: title, path: "/clients" }],
    tc("home"),
  );

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-accent-800 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(60%_60%_at_20%_20%,rgba(124,58,237,0.35),transparent),radial-gradient(50%_50%_at_80%_80%,rgba(15,23,42,0.4),transparent)]"
        />
        <div className="container-page relative py-20 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-200">{kicker}</p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl lg:text-6xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-lg text-navy-100">{subtitle}</p>
          {clients.length > 0 && (
            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-navy-200">
              {t("count", { count: clients.length })}
            </p>
          )}
        </div>
      </section>

      <section className="container-page py-16">
        {clients.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-navy-100 bg-white p-8 text-center">
            <h2 className="font-display text-2xl text-navy-900">{t("empty.title")}</h2>
            <p className="mt-3 text-sm text-navy-600">{t("empty.body")}</p>
            <Link href="/contact" className="mt-6 inline-flex items-center gap-1 btn-accent">
              {tc("talkToF2")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <article key={c.slug} className="card flex flex-col">
                <div className="flex items-start gap-3">
                  {c.logo_url ? (
                    <Image
                      src={c.logo_url}
                      alt={c.display_name}
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded-lg object-contain bg-navy-50 p-1"
                    />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-lg bg-navy-50 text-navy-500">
                      <Building2 className="h-6 w-6" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg text-navy-900 truncate">{c.display_name}</h2>
                    {c.industry_label && (
                      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-accent-700">
                        {c.industry_label}
                      </p>
                    )}
                  </div>
                </div>
                {c.services_used.length > 0 && (
                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">
                      {t("servicesLabel")}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {c.services_used.map((s) => (
                        <li
                          key={s}
                          className="rounded-full border border-navy-100 bg-navy-50 px-2 py-0.5 text-xs text-navy-700"
                        >
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {clients.length > 0 && (
        <section className="border-t border-navy-100 bg-navy-50">
          <div className="container-page py-14 text-center">
            <h2 className="font-display text-3xl text-navy-900">{t("cta.title")}</h2>
            <p className="mt-3 mx-auto max-w-xl text-navy-700">{t("cta.body")}</p>
            <Link href="/contact" className="mt-6 inline-flex items-center gap-1 btn-accent">
              {tc("talkToF2")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
