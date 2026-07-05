"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import {
  LayoutDashboard, Users, Inbox, LogOut, Menu, X, Loader2, Building2, Ticket, DollarSign, Globe, ShieldCheck, FileText, ListChecks, CreditCard, Wallet, Repeat, Undo2, Landmark, Webhook, AlertOctagon, BarChart3, PauseCircle, Home, Layers, Award, FileCode, ToggleRight, ClipboardCheck, Mail, Bot, Route, Coins,
} from "lucide-react";
import { adminApi, clearAuth, redirectToLogin, type User } from "@/lib/admin-api";
import SandboxBanner from "@/components/SandboxBanner";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { isEnabledIn } from "@/lib/modules";

type GroupKey = "workspace" | "pipeline" | "infrastructure" | "ai" | "system";

type NavItem = {
  href:
    | "/admin"
    | "/admin/leads"
    | "/admin/tickets"
    | "/admin/customers"
    | "/admin/dsr"
    | "/admin/blog"
    | "/admin/app-mode"
    | "/admin/home-content"
    | "/admin/pages"
    | "/admin/services"
    | "/admin/case-studies"
    | "/admin/users"
    | "/admin/pricing"
    | "/admin/orders/domains"
    | "/admin/invoices"
    | "/admin/payments"
    | "/admin/payment-methods"
    | "/admin/subscriptions"
    | "/admin/refunds"
    | "/admin/bank-imports"
    | "/admin/webhooks"
    | "/admin/disputes"
    | "/admin/analytics"
    | "/admin/suspensions"
    | "/admin/projects"
    | "/admin/settings/smtp"
    | "/admin/features"
    | "/admin/ai"
    | "/admin/ai/routing"
    | "/admin/ai/usage";
  labelKey: "dashboard" | "leads" | "tickets" | "customers" | "dsr" | "blog" | "appMode" | "homeContent" | "pagesEditor" | "servicesEditor" | "caseStudiesEditor" | "users" | "pricing" | "orders" | "invoices" | "payments" | "paymentMethods" | "subscriptions" | "refunds" | "bankImports" | "webhooks" | "disputes" | "analytics" | "suspensions" | "projects" | "smtp" | "features" | "aiHome" | "aiRouting" | "aiUsage";
  icon: typeof LayoutDashboard;
  exact?: boolean;
  adminOnly?: boolean;
  moduleKey?: string;
};

type NavGroup = { key: GroupKey; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    key: "workspace",
    items: [
      { href: "/admin", labelKey: "dashboard", icon: LayoutDashboard, exact: true, moduleKey: "admin.dashboard" },
      { href: "/admin/app-mode", labelKey: "appMode", icon: ToggleRight, adminOnly: true, moduleKey: "admin.app_mode" },
    ],
  },
  {
    key: "pipeline",
    items: [
      { href: "/admin/leads",     labelKey: "leads",     icon: Inbox,       moduleKey: "admin.leads" },
      { href: "/admin/tickets",   labelKey: "tickets",   icon: Ticket,      moduleKey: "admin.tickets" },
      { href: "/admin/customers", labelKey: "customers", icon: Building2,   moduleKey: "admin.customers" },
      { href: "/admin/projects",  labelKey: "projects",  icon: ClipboardCheck, moduleKey: "admin.projects" },
      { href: "/admin/dsr",           labelKey: "dsr",                icon: ShieldCheck, moduleKey: "admin.dsr" },
      { href: "/admin/blog",          labelKey: "blog",               icon: FileText,    moduleKey: "admin.blog" },
      { href: "/admin/home-content",  labelKey: "homeContent",        icon: Home,        moduleKey: "admin.home_content" },
      { href: "/admin/pages",         labelKey: "pagesEditor",        icon: FileCode,    moduleKey: "admin.pages" },
      { href: "/admin/services",      labelKey: "servicesEditor",     icon: Layers,      moduleKey: "admin.services" },
      { href: "/admin/case-studies",  labelKey: "caseStudiesEditor",  icon: Award,       moduleKey: "admin.case_studies" },
    ],
  },
  {
    key: "infrastructure",
    items: [
      { href: "/admin/orders/domains",  labelKey: "orders",         icon: Globe,        moduleKey: "admin.orders_domains" },
      { href: "/admin/pricing",         labelKey: "pricing",        icon: DollarSign,   moduleKey: "admin.pricing" },
      { href: "/admin/invoices",        labelKey: "invoices",       icon: FileText,     moduleKey: "admin.invoices" },
      { href: "/admin/payments",        labelKey: "payments",       icon: CreditCard,   moduleKey: "admin.payments" },
      { href: "/admin/subscriptions",   labelKey: "subscriptions",  icon: Repeat,       moduleKey: "admin.subscriptions" },
      { href: "/admin/refunds",         labelKey: "refunds",        icon: Undo2,        moduleKey: "admin.refunds" },
      { href: "/admin/disputes",        labelKey: "disputes",       icon: AlertOctagon, moduleKey: "admin.disputes" },
      { href: "/admin/suspensions",     labelKey: "suspensions",    icon: PauseCircle,  moduleKey: "admin.suspensions" },
      { href: "/admin/bank-imports",    labelKey: "bankImports",    icon: Landmark,     moduleKey: "admin.bank_imports" },
      { href: "/admin/analytics",       labelKey: "analytics",      icon: BarChart3,    moduleKey: "admin.invoices" },
      { href: "/admin/webhooks",        labelKey: "webhooks",       icon: Webhook,      moduleKey: "api.payment" },
      { href: "/admin/payment-methods", labelKey: "paymentMethods", icon: Wallet,       moduleKey: "admin.payment_methods" },
    ],
  },
  {
    key: "ai",
    items: [
      { href: "/admin/ai",         labelKey: "aiHome",    icon: Bot,   exact: true, adminOnly: true, moduleKey: "admin.ai" },
      { href: "/admin/ai/routing", labelKey: "aiRouting", icon: Route, adminOnly: true, moduleKey: "admin.ai" },
      { href: "/admin/ai/usage",   labelKey: "aiUsage",   icon: Coins, adminOnly: true, moduleKey: "admin.ai" },
    ],
  },
  {
    key: "system",
    items: [
      { href: "/admin/users",    labelKey: "users",    icon: Users,      adminOnly: true, moduleKey: "admin.users" },
      { href: "/admin/settings/smtp", labelKey: "smtp", icon: Mail,       adminOnly: true, moduleKey: "admin.smtp_settings" },
      { href: "/admin/features", labelKey: "features", icon: ListChecks, adminOnly: true, moduleKey: "admin.features" },
    ],
  },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.shell");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  // Hydrate optimistically from sessionStorage so client-side navs between
  // admin pages don't flash a full-screen loading spinner — the user shell is
  // already known. `me()` still runs in the background to revalidate.
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const cached = sessionStorage.getItem("f2_user");
      return cached ? (JSON.parse(cached) as User) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return !sessionStorage.getItem("f2_user");
  });
  const [open, setOpen] = useState(false);
  // Fetched once at mount alongside `me()`. Empty object means "fetch failed"
  // or "still loading" — fail-open per isEnabledIn(), so admin sees the full
  // nav rather than a half-empty one if cms-api is briefly unreachable.
  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    // No token at all → not signed in, go to login.
    if (!sessionStorage.getItem("f2_access_token")) {
      redirectToLogin();
      return;
    }

    // Kick both requests off in parallel but handle them independently so a
    // transient failure on one doesn't force a logout. Only a real 401 from
    // `me()` should clear auth and redirect — anything else (network glitch,
    // 5xx, cms-api hiccup) should leave the cached user in place.
    adminApi.me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        sessionStorage.setItem("f2_user", JSON.stringify(u));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          clearAuth();
          redirectToLogin();
          return;
        }
        // Non-auth failure — keep the cached user visible; stop showing the
        // spinner so the shell isn't stuck.
        setLoading(false);
      });

    fetch("/api/cms/modules")
      .then((r) => (r.ok ? (r.json() as Promise<Array<{ key: string; enabled: boolean }>>) : []))
      .then((rows) => {
        if (cancelled) return;
        setEnabledModules(Object.fromEntries(rows.map((r) => [r.key, r.enabled])));
      })
      .catch(() => {
        // Fail-open: empty map → isEnabledIn() treats every item as enabled.
      });

    return () => { cancelled = true; };
  }, []);

  // ESC closes the mobile drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function logout() {
    const rt = sessionStorage.getItem("f2_refresh_token");
    if (rt) {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      fetch(`${apiBase}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      }).catch(() => {});
    }
    clearAuth();
    router.push("/admin/login");
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-navy-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  const isActive = (n: NavItem) => (n.exact ? pathname === n.href : pathname.startsWith(n.href));
  const visibleGroups = NAV.map((g) => ({
    ...g,
    items: g.items.filter(
      (n) =>
        (!n.adminOnly || user.role === "admin") &&
        (!n.moduleKey || isEnabledIn(enabledModules, n.moduleKey)),
    ),
  })).filter((g) => g.items.length > 0);

  const initials = (user.full_name || user.email).slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-navy-50">
      <SandboxBanner adminCTA />
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-navy-100 bg-white px-4 py-3 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy-900 font-display text-sm font-bold text-white">F2</span>
          <span className="font-display text-base text-navy-900">{t("brand")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg p-2 text-navy-700 hover:bg-navy-50"
            aria-label={t("toggleMenu")}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
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
          {/* Mobile-only header inside drawer (close + brand) */}
          <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3 lg:hidden">
            <span className="font-display text-base text-navy-900">{t("brand")}</span>
            <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-navy-700 hover:bg-navy-50">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable nav region. `min-h-0` is required so this flex child
              can shrink below its content size, which is what actually
              enables overflow-y-auto to kick in inside a `flex flex-col`
              parent (flex items default to min-height: auto). Without it,
              a tall nav pushes the pinned identity block off-screen. */}
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
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

          {/* Pinned identity / logout block */}
          <div className="border-t border-navy-100 p-3">
            {/* Locale switcher — hidden on mobile drawer (mobile top bar has its own) */}
            <div className="mb-2 hidden justify-end lg:flex">
              <LanguageSwitcher />
            </div>
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-100 font-display text-sm font-semibold text-navy-700">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-navy-900">{user.full_name}</p>
                <p className="truncate text-xs text-navy-500">{user.email}</p>
              </div>
              <span className="shrink-0 rounded-full bg-navy-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-navy-700">
                {user.role}
              </span>
            </div>
            <button
              onClick={logout}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-700 transition hover:border-navy-300 hover:bg-navy-50"
            >
              <LogOut className="h-4 w-4" /> {t("signOut")}
            </button>
          </div>
        </aside>

        <main className="flex-1 p-4 sm:p-6 lg:p-10">
          {/* Desktop-only top strip — parks the language switcher in the
              user's eyeline instead of buried in the sidebar footer. On
              mobile the switcher lives in the sticky top bar so we hide
              this strip below lg. */}
          <div className="mb-4 hidden justify-end lg:flex">
            <LanguageSwitcher />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
