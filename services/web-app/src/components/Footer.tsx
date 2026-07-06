import { useTranslations } from "next-intl";
import { MapPin, Mail } from "lucide-react";
import { Link } from "@/i18n/routing";
import F2LogoMark from "./F2LogoMark";
import { isEnabledIn } from "@/lib/modules";

const EXPLORE_LINKS = [
  { href: "/services",     labelKey: "exploreLinks.services",     moduleKey: "public.services" },
  { href: "/domains",      labelKey: "exploreLinks.domains",      moduleKey: "public.domains" },
  { href: "/hosting",      labelKey: "exploreLinks.hosting",      moduleKey: "public.hosting" },
  { href: "/case-studies", labelKey: "exploreLinks.caseStudies",  moduleKey: "public.case_studies" },
  { href: "/clients",      labelKey: "exploreLinks.clients",      moduleKey: "public.clients" },
  { href: "/products",     labelKey: "exploreLinks.products",     moduleKey: "public.products" },
  { href: "/blog",         labelKey: "exploreLinks.blog",         moduleKey: "public.blog" },
  { href: "/about",        labelKey: "exploreLinks.about",        moduleKey: "public.about" },
] as const;

const LEGAL_LINKS = [
  { href: "/privacy", labelKey: "privacy", moduleKey: "public.privacy" },
  { href: "/terms",   labelKey: "terms",   moduleKey: "public.terms" },
  { href: "/dpa",     labelKey: "dpa",     moduleKey: "public.dpa" },
] as const;

export default function Footer({
  enabledModules = {},
}: {
  enabledModules?: Record<string, boolean>;
}) {
  const t = useTranslations("footer");
  const explore = EXPLORE_LINKS.filter((l) => isEnabledIn(enabledModules, l.moduleKey));
  const legal   = LEGAL_LINKS.filter((l) => isEnabledIn(enabledModules, l.moduleKey));
  return (
    <footer className="mt-24 border-t border-navy-100 bg-navy-900 text-navy-100">
      <div className="container-page py-12 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-navy-900">
              <F2LogoMark className="h-5 w-5" />
            </span>
            <span className="font-display text-lg">F2 Co., Ltd.</span>
          </div>
          <p className="mt-4 max-w-md text-sm text-navy-300">{t("tagline")}</p>
          <p className="mt-4 text-xs text-navy-400">{t("formerName")}</p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white">{t("explore")}</h4>
          <ul className="mt-3 space-y-2 text-sm">
            {explore.map((l) => (
              <li key={l.href}>
                <Link href={l.href as never} className="hover:text-white">{t(l.labelKey)}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white">{t("partners.title")}</h4>
          <ul className="mt-3 space-y-2 text-sm text-navy-300">
            {(t.raw("partners.lines") as string[]).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white">{t("contact")}</h4>
          <ul className="mt-3 space-y-2 text-sm text-navy-300">
            <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {t("officesValue")}</li>
            <li className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0" /> info@f2.co.th</li>
          </ul>
          <Link href="/contact" className="mt-4 inline-block btn-accent">{t("startProject")}</Link>
        </div>
      </div>

      <div className="border-t border-navy-800">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-4 text-xs text-navy-400 md:flex-row md:items-center">
          <span>&copy; {new Date().getFullYear()} F2 Co., Ltd. {t("rights")}</span>
          <div className="flex gap-4">
            {legal.map((l) => (
              <Link key={l.href} href={l.href as never} className="hover:text-white">
                {t(l.labelKey)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
