// Per-case-study OG image — surfaces client name + summary so social
// shares of /case-studies/sala-hospitality etc. read as "F2 · SALA" not
// as the default site tagline.

import { cms } from "@/lib/api";
import { renderOG, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "F2 case study";

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function Image({ params }: Props) {
  const { locale, slug } = await params;
  const l = locale === "th" ? "th" : "en";
  const c = await cms.getCaseStudy(slug, locale);
  const title = c?.client_name ?? (l === "th" ? "กรณีศึกษา F2" : "F2 Case Study");
  return await renderOG({
    locale: l,
    kicker: l === "th" ? "กรณีศึกษา" : "CASE STUDY",
    title,
    subtitle: c?.summary ?? "",
  });
}
