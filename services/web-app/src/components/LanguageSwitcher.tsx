"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/routing";
import type { AppLocale } from "@/i18n/routing";

const locales: AppLocale[] = ["en", "th"];
const codes: Record<AppLocale, string> = { en: "EN", th: "TH" };

export default function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale() as AppLocale;
  const [isPending, startTransition] = useTransition();

  function setLocale(next: AppLocale) {
    if (next === currentLocale) return;
    startTransition(() => {
      // Persist preference for one year so subsequent visits land on the right tree.
      document.cookie = `f2_locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="inline-flex items-center rounded-full bg-navy-100/70 p-0.5 text-xs font-medium"
    >
      {locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => setLocale(loc)}
          disabled={isPending}
          aria-label={t("switchTo", { lang: t(loc) })}
          aria-current={loc === currentLocale}
          className={`rounded-full px-2.5 py-1 transition whitespace-nowrap ${
            loc === currentLocale
              ? "bg-white text-navy-900 shadow-sm"
              : "text-navy-600 hover:text-navy-900"
          }`}
        >
          {codes[loc]}
        </button>
      ))}
    </div>
  );
}
