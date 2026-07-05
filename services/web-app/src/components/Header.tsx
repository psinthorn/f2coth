"use client";

import { useState } from "react";
import { ChevronDown, LogIn, Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import LanguageSwitcher from "./LanguageSwitcher";
import { isEnabledIn } from "@/lib/modules";

type NavLeaf = { kind: "leaf"; href: string; labelKey: string; moduleKey: string };
type NavGroup = {
  kind: "group";
  labelKey: string;
  items: { href: string; labelKey: string; moduleKey: string }[];
};
type NavItem = NavLeaf | NavGroup;

export default function Header({
  enabledModules = {},
}: {
  enabledModules?: Record<string, boolean>;
}) {
  const t = useTranslations("header");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const allNav: NavItem[] = [
    { kind: "leaf", href: "/services",     labelKey: "services",    moduleKey: "public.services" },
    { kind: "leaf", href: "/case-studies", labelKey: "caseStudies", moduleKey: "public.case_studies" },
    { kind: "leaf", href: "/clients",      labelKey: "clients",     moduleKey: "public.clients" },
    { kind: "leaf", href: "/products",     labelKey: "products",    moduleKey: "public.products" },
    {
      kind: "group", labelKey: "infrastructure",
      items: [
        { href: "/domains", labelKey: "domains", moduleKey: "public.domains" },
        { href: "/hosting", labelKey: "hosting", moduleKey: "public.hosting" },
      ],
    },
    { kind: "leaf", href: "/blog",    labelKey: "blog",    moduleKey: "public.blog" },
    { kind: "leaf", href: "/about",   labelKey: "about",   moduleKey: "public.about" },
    { kind: "leaf", href: "/contact", labelKey: "contact", moduleKey: "public.contact" },
  ];

  // Filter out disabled modules; collapse groups that have lost all children.
  const nav: NavItem[] = allNav
    .map((item) => {
      if (item.kind === "leaf") {
        return isEnabledIn(enabledModules, item.moduleKey) ? item : null;
      }
      const subs = item.items.filter((s) => isEnabledIn(enabledModules, s.moduleKey));
      return subs.length > 0 ? { ...item, items: subs } : null;
    })
    .filter((x): x is NavItem => x !== null);

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-navy-100 bg-white/85 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        {/* Logo (also home link) */}
        <Link href="/" className="flex shrink-0 items-center" aria-label="F2 Co., Ltd.">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy-800 font-display text-lg font-bold text-white">
            F2
          </span>
        </Link>

        {/* Primary nav (desktop ≥ lg) */}
        <nav className="hidden lg:flex flex-1 items-center justify-center gap-0.5">
          {nav.map((item) => {
            if (item.kind === "leaf") {
              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                    isActive(item.href)
                      ? "bg-navy-50 text-navy-900 font-medium"
                      : "text-navy-600 hover:text-navy-900 hover:bg-navy-50/60"
                  }`}
                >
                  {t(`nav.${item.labelKey}`)}
                </Link>
              );
            }
            const groupActive = item.items.some((i) => isActive(i.href));
            const isOpen = openGroup === item.labelKey;
            return (
              <div
                key={item.labelKey}
                className="relative"
                onMouseEnter={() => setOpenGroup(item.labelKey)}
                onMouseLeave={() => setOpenGroup(null)}
              >
                <button
                  type="button"
                  onClick={() => setOpenGroup(isOpen ? null : item.labelKey)}
                  className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                    groupActive
                      ? "bg-navy-50 text-navy-900 font-medium"
                      : "text-navy-600 hover:text-navy-900 hover:bg-navy-50/60"
                  }`}
                  aria-expanded={isOpen}
                >
                  {t(`nav.${item.labelKey}`)}
                  <ChevronDown className={`h-3.5 w-3.5 transition ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="absolute left-1/2 top-full -translate-x-1/2 pt-1.5">
                    <div className="min-w-[12rem] overflow-hidden rounded-xl border border-navy-100 bg-white shadow-lg">
                      {item.items.map((sub) => (
                        <Link
                          key={sub.href}
                          href={sub.href as never}
                          onClick={() => setOpenGroup(null)}
                          className={`block whitespace-nowrap px-4 py-2.5 text-sm transition ${
                            isActive(sub.href)
                              ? "bg-navy-50 text-navy-900 font-medium"
                              : "text-navy-700 hover:bg-navy-50"
                          }`}
                        >
                          {t(`nav.${sub.labelKey}`)}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Right cluster (desktop ≥ lg) */}
        <div className="hidden lg:flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          <Link
            href="/portal/login"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm text-navy-700 transition hover:bg-navy-50 hover:text-navy-900"
            title={t("customerLogin")}
          >
            <LogIn className="h-4 w-4" />
            <span className="hidden xl:inline">{t("customerLogin")}</span>
          </Link>
          <Link
            href="/contact"
            className="whitespace-nowrap btn-accent"
          >
            {tc("talkToF2")}
          </Link>
        </div>

        {/* Mobile cluster (< lg) */}
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <LanguageSwitcher />
          <button
            aria-label={t("toggleMenu")}
            aria-expanded={open}
            className="rounded-lg p-2 text-navy-700 hover:bg-navy-50"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden border-t border-navy-100 bg-white">
          <div className="container-page flex flex-col py-2">
            {nav.map((item) => {
              if (item.kind === "leaf") {
                return (
                  <Link
                    key={item.href}
                    href={item.href as never}
                    onClick={() => setOpen(false)}
                    className={`rounded-lg px-3 py-2.5 text-sm transition ${
                      isActive(item.href)
                        ? "bg-navy-50 text-navy-900 font-medium"
                        : "text-navy-700 hover:bg-navy-50"
                    }`}
                  >
                    {t(`nav.${item.labelKey}`)}
                  </Link>
                );
              }
              return (
                <div key={item.labelKey} className="mt-1">
                  <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-navy-500">
                    {t(`nav.${item.labelKey}`)}
                  </p>
                  {item.items.map((sub) => (
                    <Link
                      key={sub.href}
                      href={sub.href as never}
                      onClick={() => setOpen(false)}
                      className={`rounded-lg px-3 py-2.5 text-sm transition ${
                        isActive(sub.href)
                          ? "bg-navy-50 text-navy-900 font-medium"
                          : "text-navy-700 hover:bg-navy-50"
                      }`}
                    >
                      {t(`nav.${sub.labelKey}`)}
                    </Link>
                  ))}
                </div>
              );
            })}
            <Link
              href="/portal/login"
              onClick={() => setOpen(false)}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-navy-200 px-3 py-2.5 text-sm text-navy-700 hover:bg-navy-50"
            >
              <LogIn className="h-4 w-4" /> {t("customerLogin")}
            </Link>
            <Link href="/contact" onClick={() => setOpen(false)} className="mt-2 btn-accent">
              {tc("talkToF2")}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
