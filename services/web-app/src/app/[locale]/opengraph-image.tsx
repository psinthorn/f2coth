// Default OG image — served for every locale-root URL and inherited by
// any child route that doesn't declare its own opengraph-image.tsx.
// Renders the F2 brand tagline so social shares of the home page,
// /about, /contact etc. all read as one family.

import { renderOG, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "F2 Co., Ltd. — Hospitality-grade IT for Thailand";

type Props = { params: Promise<{ locale: string }> };

export default async function Image({ params }: Props) {
  const { locale } = await params;
  const l = locale === "th" ? "th" : "en";
  return await renderOG({
    locale: l,
    kicker: l === "th" ? "F2 CO., LTD." : "F2 CO., LTD.",
    title:
      l === "th"
        ? "ไอทีระดับโรงแรมสำหรับธุรกิจไทย"
        : "Hospitality-grade IT for Thailand",
    subtitle:
      l === "th"
        ? "จัดการระบบไอที ความปลอดภัย คลาวด์ และ AI ให้กับโรงแรม วิลล่า และรีสอร์ตหรูทั่วประเทศ"
        : "IT management, cybersecurity, cloud, and AI for luxury hotels, villas, and resorts.",
  });
}
