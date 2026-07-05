import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Calendar, User } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { pageAlternates, pageOpenGraph, pageBreadcrumb, localizedUrl } from "@/lib/seo";
import { JsonLd, breadcrumbList, blogPosting } from "@/lib/schema";
import CMSPageBody from "@/components/CMSPageBody";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await cms.getBlogPost(slug, locale);
  if (!post) return { title: "Post not found" };
  return {
    title: post.title,
    description: post.excerpt,
    alternates: pageAlternates(locale, `/blog/${slug}`),
    // OG image comes from the sibling opengraph-image.tsx (dynamic,
    // brand-styled 1200×630). We deliberately don't pass cover_image_url
    // here so social cards stay visually consistent site-wide.
    ...pageOpenGraph({
      locale,
      path: `/blog/${slug}`,
      title: post.title,
      description: post.excerpt,
    }),
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");
  const tCommon = await getTranslations("common");

  const post = await cms.getBlogPost(slug, locale);
  if (!post) notFound();

  const breadcrumbs = pageBreadcrumb(
    locale,
    [
      { name: t("title"), path: "/blog" },
      { name: post.title, path: `/blog/${slug}` },
    ],
    tCommon("home"),
  );

  const publishedAt = post.published_at ?? new Date().toISOString();
  const url = localizedUrl(locale, `/blog/${slug}`);

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <JsonLd
        data={blogPosting({
          url,
          headline: post.title,
          description: post.excerpt,
          datePublished: publishedAt,
          dateModified: post.updated_at ?? publishedAt,
          image: post.cover_image_url ?? undefined,
          authorName: post.author_name,
          inLanguage: locale as "en" | "th",
        })}
      />

      <article>
        <section className="bg-navy-50">
          <div className="container-page py-16">
            <Link href="/blog" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
              <ArrowLeft className="h-3.5 w-3.5" /> {t("backToList")}
            </Link>
            <h1 className="mt-6 font-display text-4xl text-navy-900 sm:text-5xl">{post.title}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-navy-600">
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> {post.author_name}
              </span>
              {post.published_at && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <time dateTime={post.published_at}>
                    {new Date(post.published_at).toLocaleDateString(
                      locale === "th" ? "th-TH" : "en-GB",
                      { day: "numeric", month: "long", year: "numeric" },
                    )}
                  </time>
                </span>
              )}
              {post.tags.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {post.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-white px-2 py-0.5 text-xs text-navy-700">#{tag}</span>
                  ))}
                </span>
              )}
            </div>
            {post.excerpt && (
              <p className="mt-6 max-w-2xl text-lg text-navy-700">{post.excerpt}</p>
            )}
          </div>
        </section>

        {post.cover_image_url && (
          <div className="container-page pt-8">
            <img
              src={post.cover_image_url}
              alt={post.title}
              className="w-full rounded-xl object-cover"
              loading="eager"
            />
          </div>
        )}

        <section className="container-page py-12">
          <div className="max-w-3xl">
            <CMSPageBody markdown={post.body_md} />
          </div>
        </section>
      </article>
    </>
  );
}
