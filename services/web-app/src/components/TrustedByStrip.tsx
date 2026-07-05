import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Building2 } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { isModuleEnabled } from "@/lib/modules";

// TrustedByStrip — horizontal band shown on marketing pages (home, about).
//
// Renders nothing when any of these are true:
//   - module `public.trusted_by_strip` is disabled
//   - no consenting clients are on file (list is empty)
//
// Sources the same consented rows as `/clients` (via cms.listPublicClients),
// so consent + admin toggling flows through the same gates. When `/clients`
// is enabled, we also render a "See all clients" link into the strip.

const MAX_CLIENTS_SHOWN = 12;

export default async function TrustedByStrip({ locale }: { locale: string }) {
  if (!(await isModuleEnabled("public.trusted_by_strip"))) return null;

  const [clients, clientsPageOn] = await Promise.all([
    cms.listPublicClients(locale),
    isModuleEnabled("public.clients"),
  ]);

  if (clients.length === 0) return null;

  const t = await getTranslations("trustedBy");
  const shown = clients.slice(0, MAX_CLIENTS_SHOWN);

  return (
    <section aria-labelledby="trusted-by-heading" className="border-y border-navy-100 bg-white">
      <div className="container-page py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            id="trusted-by-heading"
            className="text-xs font-semibold uppercase tracking-wider text-navy-500"
          >
            {t("title")}
          </h2>
          {clientsPageOn && (
            <Link
              href="/clients"
              className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-accent-700"
            >
              {t("seeAll")} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {shown.map((c) => (
            <li key={c.slug} className="flex items-center gap-2">
              {c.logo_url ? (
                <Image
                  src={c.logo_url}
                  alt={c.display_name}
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded object-contain opacity-70 grayscale transition group-hover:opacity-100"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid h-8 w-8 shrink-0 place-items-center rounded bg-navy-50 text-navy-400"
                >
                  <Building2 className="h-4 w-4" />
                </span>
              )}
              <span className="truncate text-sm font-medium text-navy-800" title={c.display_name}>
                {c.display_name}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
