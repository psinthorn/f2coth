// Per-service OG image — pulls the service's title + short_summary from
// the CMS so social shares of /services/it-management etc. carry the
// actual service headline, not the default site tagline.

import { cms } from "@/lib/api";
import { renderOG, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "F2 service";

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function Image({ params }: Props) {
  const { locale, slug } = await params;
  const l = locale === "th" ? "th" : "en";
  const services = await cms.listServices(locale);
  const s = services.find((x) => x.slug === slug);
  const title = s?.title ?? (l === "th" ? "บริการของ F2" : "F2 Service");
  const subtitle = s?.short_summary ?? "";
  return await renderOG({
    locale: l,
    kicker: l === "th" ? "บริการ" : "SERVICE",
    title,
    subtitle,
  });
}
