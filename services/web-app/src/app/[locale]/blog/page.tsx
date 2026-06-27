import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Newspaper } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.blog" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/blog"),
    ...pageOpenGraph({ locale, path: "/blog", title, description }),
  };
}

export default async function BlogPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");
  const tCommon = await getTranslations("common");

  const posts = await cms.listBlogPosts(locale);
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: t("title"), path: "/blog" }],
    tCommon("home"),
  );

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <section className="bg-navy-50">
        <div className="container-page py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("kicker")}</p>
          <h1 className="mt-2 font-display text-4xl text-navy-900 sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-2xl text-navy-600">{t("subtitle")}</p>
        </div>
      </section>

      <section className="container-page py-16">
        {posts.length === 0 ? (
          <div className="card mx-auto max-w-xl text-center">
            <Newspaper className="mx-auto h-8 w-8 text-accent-600" />
            <h2 className="mt-4 font-display text-2xl text-navy-900">{t("empty.title")}</h2>
            <p className="mt-2 text-sm text-navy-600">{t("empty.body")}</p>
            <Link href="/case-studies" className="mt-6 inline-flex btn-accent">
              {t("empty.cta")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} className="card group">
                <h2 className="font-display text-xl text-navy-900 group-hover:text-accent-800">{p.title}</h2>
                <p className="mt-2 text-sm text-navy-600">{p.excerpt}</p>
                <p className="mt-4 text-xs text-navy-500">
                  {p.published_at ? new Date(p.published_at).toLocaleDateString(locale === "th" ? "th-TH" : "en-US") : ""}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
