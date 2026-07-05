// Per-blog-post OG image — pulls title + excerpt so shares of
// /blog/{slug} carry the actual post headline. Falls back to the
// default site OG (via the parent [locale]/opengraph-image.tsx) if the
// post lookup fails.

import { cms } from "@/lib/api";
import { renderOG, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "F2 blog post";

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function Image({ params }: Props) {
  const { locale, slug } = await params;
  const l = locale === "th" ? "th" : "en";
  const post = await cms.getBlogPost(slug, locale);
  const title = post?.title ?? (l === "th" ? "บทความ" : "F2 Blog");
  return await renderOG({
    locale: l,
    kicker: l === "th" ? "บทความ" : "BLOG",
    title,
    subtitle: post?.excerpt ?? "",
  });
}
