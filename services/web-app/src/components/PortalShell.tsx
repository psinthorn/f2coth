"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import {
  LayoutDashboard, Inbox, LogOut, Menu, X, Loader2, Building2, Globe, ShieldCheck, Receipt, FileSignature, ClipboardCheck,
} from "lucide-react";
import { portalApi, clearPortalAuth, redirectToPortalLogin, type PortalContact, type PortalCustomer } from "@/lib/portal-api";
import SandboxBanner from "@/components/SandboxBanner";
import SuspendedServicesBanner from "@/components/SuspendedServicesBanner";
import F2LogoMark from "@/components/F2LogoMark";

type GroupKey = "workspace" | "support" | "services";

type NavItem = {
  href: "/portal" | "/portal/tickets" | "/portal/domains" | "/portal/sla" | "/portal/billing" | "/portal/billing-profile" | "/portal/projects";
  labelKey: "account" | "tickets" | "domains" | "sla" | "billing" | "billingProfile" | "projects";
  icon: typeof LayoutDashboard;
  exact?: boolean;
  requireService?: string;
  requireSLA?: boolean;
};

type NavGroup = { key: GroupKey; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    key: "workspace",
    items: [
      { href: "/portal", labelKey: "account", icon: LayoutDashboard, exact: true },
      { href: "/portal/billing", labelKey: "billing", icon: Receipt },
      { href: "/portal/billing-profile", labelKey: "billingProfile", icon: FileSignature },
    ],
  },
  {
    key: "support",
    items: [
      { href: "/portal/tickets", labelKey: "tickets", icon: Inbox },
      { href: "/portal/projects", labelKey: "projects", icon: ClipboardCheck },
    ],
  },
  {
    key: "services",
    items: [
      { href: "/portal/domains", labelKey: "domains", icon: Globe, requireService: "domain-hosting" },
      { href: "/portal/sla", labelKey: "sla", icon: ShieldCheck, requireSLA: true },
    ],
  },
];

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("portal.shell");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [contact, setContact] = useState<PortalContact | null>(null);
  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [hasSLA, setHasSLA] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!sessionStorage.getItem("f2_portal_access_token")) {
      redirectToPortalLogin();
      return;
    }

    portalApi
      .me()
      .then((d) => {
        if (!cancelled) {
          setContact(d.contact);
          setCustomer(d.customer);
        }
        return portalApi.listSLA().then(() => true).catch(() => false);
      })
      .then((sla) => {
        if (!cancelled) {
          setHasSLA(!!sla);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearPortalAuth();
          redirectToPortalLogin();
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function logout() {
    await portalApi.logout();
    clearPortalAuth();
    router.push("/portal/login");
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-navy-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!contact || !customer) return null;

  const isActive = (n: NavItem) => (n.exact ? pathname === n.href : pathname.startsWith(n.href));
  const visibleGroups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((n) => {
      if (n.requireService && !customer.services_used.includes(n.requireService)) return false;
      if (n.requireSLA && !hasSLA) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);

  const initials = (contact.full_name || contact.email).slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-navy-50">
      <SandboxBanner />
      <SuspendedServicesBanner />
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-navy-100 bg-white px-4 py-3 lg:hidden">
        <Link href="/portal" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-700 text-white">
            <F2LogoMark className="h-4 w-4" />
          </span>
          <span className="font-display text-base text-navy-900">{t("title")}</span>
        </Link>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-navy-700 hover:bg-navy-50"
          aria-label={t("toggleMenu")}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {open && (
        <button
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-navy-900/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <div className="lg:flex">
        <aside
          className={`
            ${open ? "fixed inset-y-0 left-0 z-40 w-72 shadow-xl" : "hidden"}
            lg:sticky lg:top-0 lg:z-auto lg:block lg:h-screen lg:w-64 lg:shrink-0 lg:shadow-none
            flex flex-col bg-white border-r border-navy-100
          `}
        >
          {/* Mobile drawer header */}
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3 lg:hidden">
            <span className="font-display text-base text-navy-900">{t("title")}</span>
            <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-navy-700 hover:bg-navy-50">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Customer/org chip */}
          <div className="border-b border-navy-100 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-navy-400">{t("organisation")}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-navy-900">
              <Building2 className="h-3.5 w-3.5 text-navy-400 shrink-0" />
              <span className="truncate">{customer.name}</span>
            </p>
          </div>

          {/* Scrollable nav */}
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {visibleGroups.map((g, gi) => (
              <div key={g.key} className={gi > 0 ? "mt-5" : ""}>
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">
                  {t(`groups.${g.key}`)}
                </p>
                <div className="flex flex-col gap-0.5">
                  {g.items.map((n) => {
                    const active = isActive(n);
                    const Icon = n.icon;
                    return (
                      <Link
                        key={n.href}
                        href={n.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                          active
                            ? "bg-accent-50 font-medium text-accent-800"
                            : "text-navy-700 hover:bg-navy-50 hover:text-navy-900"
                        }`}
                      >
                        {active && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent-600" />
                        )}
                        <Icon className={`h-4 w-4 ${active ? "text-accent-700" : "text-navy-400 group-hover:text-navy-600"}`} />
                        <span className="truncate">{t(`nav.${n.labelKey}`)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Identity */}
          <div className="border-t border-navy-100 p-3">
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-50 font-display text-sm font-semibold text-accent-800">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-navy-900">{contact.full_name}</p>
                <p className="truncate text-xs text-navy-500">{contact.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-700 transition hover:border-navy-300 hover:bg-navy-50"
            >
              <LogOut className="h-4 w-4" /> {t("signOut")}
            </button>
          </div>
        </aside>

        <main className="flex-1 p-4 sm:p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}

export type { PortalContact, PortalCustomer };
