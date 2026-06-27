"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import {
  LayoutDashboard, Users, Inbox, LogOut, Menu, X, Loader2, Building2, Ticket, DollarSign, Globe, ShieldCheck, FileText,
} from "lucide-react";
import { adminApi, clearAuth, redirectToLogin, type User } from "@/lib/admin-api";

type GroupKey = "workspace" | "pipeline" | "infrastructure" | "system";

type NavItem = {
  href:
    | "/admin"
    | "/admin/leads"
    | "/admin/tickets"
    | "/admin/customers"
    | "/admin/dsr"
    | "/admin/blog"
    | "/admin/users"
    | "/admin/pricing"
    | "/admin/orders/domains";
  labelKey: "dashboard" | "leads" | "tickets" | "customers" | "dsr" | "blog" | "users" | "pricing" | "orders";
  icon: typeof LayoutDashboard;
  exact?: boolean;
  adminOnly?: boolean;
};

type NavGroup = { key: GroupKey; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    key: "workspace",
    items: [
      { href: "/admin", labelKey: "dashboard", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    key: "pipeline",
    items: [
      { href: "/admin/leads", labelKey: "leads", icon: Inbox },
      { href: "/admin/tickets", labelKey: "tickets", icon: Ticket },
      { href: "/admin/customers", labelKey: "customers", icon: Building2 },
      { href: "/admin/dsr", labelKey: "dsr", icon: ShieldCheck },
      { href: "/admin/blog", labelKey: "blog", icon: FileText },
    ],
  },
  {
    key: "infrastructure",
    items: [
      { href: "/admin/orders/domains", labelKey: "orders", icon: Globe },
      { href: "/admin/pricing", labelKey: "pricing", icon: DollarSign },
    ],
  },
  {
    key: "system",
    items: [
      { href: "/admin/users", labelKey: "users", icon: Users, adminOnly: true },
    ],
  },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.shell");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!sessionStorage.getItem("f2_access_token")) {
      redirectToLogin();
      return;
    }

    adminApi
      .me()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          sessionStorage.setItem("f2_user", JSON.stringify(u));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearAuth();
          redirectToLogin();
        }
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
    items: g.items.filter((n) => !n.adminOnly || user.role === "admin"),
  })).filter((g) => g.items.length > 0);

  const initials = (user.full_name || user.email).slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-navy-50">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-navy-100 bg-white px-4 py-3 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy-900 font-display text-sm font-bold text-white">F2</span>
          <span className="font-display text-base text-navy-900">{t("brand")}</span>
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

          {/* Scrollable nav region */}
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

          {/* Pinned identity / logout block */}
          <div className="border-t border-navy-100 p-3">
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

        <main className="flex-1 p-4 sm:p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
