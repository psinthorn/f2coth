import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

// Top-level 404. Renders within the root layout (no Header/Footer/ChatWidget).
// Locale resolution falls back to the default; admins/portal also land here
// for any URL that doesn't match a configured route.
export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "notFound" });
  return (
    <section className="container-page py-24 text-center">
      <p className="font-display text-7xl text-accent-600">{t("code")}</p>
      <h1 className="mt-4 font-display text-3xl text-navy-900">{t("title")}</h1>
      <p className="mt-3 text-navy-600">{t("body")}</p>
      <Link href="/" className="mt-8 inline-flex btn-accent">{t("cta")}</Link>
    </section>
  );
}
