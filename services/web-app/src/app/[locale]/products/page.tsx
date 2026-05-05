import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight, ExternalLink, Calculator, Cog, Users,
  MapPin, Car, ShoppingBag, CheckCircle2, Sparkles,
} from "lucide-react";
import { Link } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.products" });
  return { title: t("title"), description: t("description") };
}

export default async function ProductsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("products");

  const accountingItems = t.raw("core.accounting.items") as string[];
  const operationsItems = t.raw("core.operations.items") as string[];
  const adminItems = t.raw("core.admin.items") as string[];
  const freePerks = t.raw("pricing.free.perks") as string[];
  const proPerks = t.raw("pricing.pro.perks") as string[];
  const enterprisePerks = t.raw("pricing.enterprise.perks") as string[];

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-navy-900 via-navy-800 to-accent-800 text-white">
        <div className="container-page py-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-200">{t("kicker")}</p>
          <h1 className="mt-2 font-display text-4xl sm:text-6xl">{t("name")}</h1>
          <p className="mt-3 text-xl text-navy-200">{t("tagline")}</p>
          <p className="mt-6 max-w-2xl text-navy-200" dangerouslySetInnerHTML={{ __html: t.raw("lead") }} />
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="https://iacc.f2.co.th" target="_blank" rel="noreferrer" className="btn-accent">
              {t("ctaTry")} <ExternalLink className="h-4 w-4" />
            </a>
            <Link href="/contact?service=iacc-saas" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">
              {t("ctaTalk")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-8 text-sm text-navy-300">{t("socialProof")}</p>
        </div>
      </section>

      {/* iACC Core */}
      <section className="container-page py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("core.kicker")}</p>
          <h2 className="mt-2 font-display text-3xl text-navy-900">{t("core.title")}</h2>
          <p className="mt-3 text-navy-600">{t("core.subtitle")}</p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <div className="card">
            <Calculator className="h-6 w-6 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("core.accounting.title")}</h3>
            <ul className="mt-3 space-y-2 text-sm text-navy-700">
              {accountingItems.map((it) => <li key={it}>{it}</li>)}
            </ul>
          </div>

          <div className="card">
            <Cog className="h-6 w-6 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("core.operations.title")}</h3>
            <ul className="mt-3 space-y-2 text-sm text-navy-700">
              {operationsItems.map((it) => <li key={it}>{it}</li>)}
              <li className="flex items-start gap-1.5">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600" />
                {t("core.operations.aiParser")}
              </li>
            </ul>
          </div>

          <div className="card">
            <Users className="h-6 w-6 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("core.admin.title")}</h3>
            <ul className="mt-3 space-y-2 text-sm text-navy-700">
              {adminItems.map((it) => <li key={it}>{it}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-navy-50 py-20">
        <div className="container-page">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("pricing.kicker")}</p>
            <h2 className="mt-2 font-display text-3xl text-navy-900">{t("pricing.title")}</h2>
            <p className="mt-3 text-navy-600">{t("pricing.subtitle")}</p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <PriceCard name={t("pricing.free.name")} price={t("pricing.free.price")} period={t("pricing.free.period")}
              perks={freePerks} cta={{ label: t("pricing.free.cta"), href: "https://iacc.f2.co.th", external: true }} />
            <PriceCard name={t("pricing.pro.name")} price={t("pricing.pro.price")} period={t("pricing.pro.period")} featured
              badge={t("pricing.pro.badge")}
              perks={proPerks} cta={{ label: t("pricing.pro.cta"), href: "https://iacc.f2.co.th", external: true }} />
            <PriceCard name={t("pricing.enterprise.name")} price={t("pricing.enterprise.price")} period={t("pricing.enterprise.period")}
              perks={enterprisePerks} cta={{ label: t("pricing.enterprise.cta"), href: "/contact?service=iacc-saas", external: false }} />
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="container-page py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("modules.kicker")}</p>
          <h2 className="mt-2 font-display text-3xl text-navy-900">{t("modules.title")}</h2>
          <p className="mt-3 text-navy-600" dangerouslySetInnerHTML={{ __html: t.raw("modules.subtitle") }} />
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <ModuleCard
            icon={<MapPin className="h-6 w-6 text-accent-700" />}
            name={t("modules.tour.name")}
            servesLabel={t("modules.tour.serves")}
            blurb={t("modules.tour.blurb")}
            firstCustomer={t("modules.tour.firstCustomer")}
            firstCustomerLabel={t("modules.firstCustomer")}
            registerInterest={t("modules.registerInterest")}
            comingSoon={(await getTranslations("common"))("comingSoon")}
            slug="tour-operator"
          />
          <ModuleCard
            icon={<Car className="h-6 w-6 text-accent-700" />}
            name={t("modules.transfer.name")}
            servesLabel={t("modules.transfer.serves")}
            blurb={t("modules.transfer.blurb")}
            firstCustomerLabel={t("modules.firstCustomer")}
            registerInterest={t("modules.registerInterest")}
            comingSoon={(await getTranslations("common"))("comingSoon")}
            slug="transfer-service"
          />
          <ModuleCard
            icon={<ShoppingBag className="h-6 w-6 text-accent-700" />}
            name={t("modules.ecommerce.name")}
            servesLabel={t("modules.ecommerce.serves")}
            blurb={t("modules.ecommerce.blurb")}
            firstCustomerLabel={t("modules.firstCustomer")}
            registerInterest={t("modules.registerInterest")}
            comingSoon={(await getTranslations("common"))("comingSoon")}
            slug="ecommerce-web-templates"
          />
        </div>
      </section>

      {/* Closing CTA */}
      <section className="container-page pb-24">
        <div className="rounded-2xl bg-navy-900 px-8 py-16 text-center text-white">
          <h2 className="mx-auto max-w-2xl font-display text-3xl">{t("closing.title")}</h2>
          <p className="mx-auto mt-4 max-w-xl text-navy-300">{t("closing.subtitle")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="https://iacc.f2.co.th" target="_blank" rel="noreferrer" className="btn-accent">
              {t("ctaTry")} <ExternalLink className="h-4 w-4" />
            </a>
            <Link href="/contact?service=iacc-saas" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">
              {(await getTranslations("common"))("talkToF2")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function PriceCard({
  name, price, period, perks, cta, featured, badge,
}: {
  name: string; price: string; period: string;
  perks: string[];
  cta: { label: string; href: string; external: boolean };
  featured?: boolean;
  badge?: string;
}) {
  return (
    <div className={`card flex flex-col ${featured ? "ring-2 ring-accent-500 shadow-card-hover" : ""}`}>
      {featured && badge && <span className="badge mb-3 self-start">{badge}</span>}
      <h3 className="font-display text-2xl text-navy-900">{name}</h3>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-display text-4xl text-navy-900">{price}</span>
        <span className="text-sm text-navy-500">{period}</span>
      </div>
      <ul className="mt-5 flex-1 space-y-2 text-sm text-navy-700">
        {perks.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {cta.external ? (
        <a href={cta.href} target="_blank" rel="noreferrer"
           className={`mt-6 ${featured ? "btn-accent" : "btn-ghost"}`}>
          {cta.label} <ExternalLink className="h-4 w-4" />
        </a>
      ) : (
        <Link href={cta.href}
              className={`mt-6 ${featured ? "btn-accent" : "btn-ghost"}`}>
          {cta.label} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

function ModuleCard({
  icon, name, servesLabel, blurb, slug, firstCustomer, firstCustomerLabel,
  registerInterest, comingSoon,
}: {
  icon: React.ReactNode; name: string; servesLabel: string;
  blurb: string; slug: string; firstCustomer?: string; firstCustomerLabel: string;
  registerInterest: string; comingSoon: string;
}) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-3">
        {icon}
        <span className="badge">{comingSoon}</span>
      </div>
      <h3 className="mt-4 font-display text-xl text-navy-900">{name}</h3>
      <p className="mt-1 text-xs uppercase tracking-wider text-navy-500">{servesLabel}</p>
      <p className="mt-3 text-sm text-navy-700 flex-1">{blurb}</p>
      {firstCustomer && (
        <p className="mt-4 rounded-lg bg-accent-50 p-3 text-xs text-accent-800">
          <span className="font-semibold">{firstCustomerLabel}</span> {firstCustomer}
        </p>
      )}
      <Link
        href={`/contact?service=iacc-saas&module=${slug}`}
        className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:text-accent-900"
      >
        {registerInterest} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
