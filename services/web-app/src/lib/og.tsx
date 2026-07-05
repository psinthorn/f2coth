// Shared OG image renderer for the file-based
// opengraph-image.tsx convention (Next.js App Router).
//
// Every route that ships a per-page OG image imports `renderOG()` and
// passes { title, subtitle, kicker } — the visual output stays consistent
// across the site so social-share cards read as one brand family.
//
// ImageResponse renders JSX to PNG at request time. It uses a subset of
// CSS via inline `style` — no external CSS, no Tailwind, no @font-face
// unless we pipe in a font Buffer. System-serif fallback is acceptable
// for the volume of routes we ship; upgrading to Inter/Sarabun is a
// future improvement.

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

// Font loader — memoized so cold-start pays the network cost once, then
// every subsequent render hits the in-memory cache. On fetch failure we
// return `null` and `renderOG` falls back to system fonts silently.
//
// Inter (Latin) covers EN copy; Sarabun (Thai script) covers TH copy.
// Both are Google-hosted static woff2 files served without a CSS
// redirect layer, so one fetch per family.
type FontData = { name: string; data: ArrayBuffer; weight: 400 | 700 | 800 };
let cachedFonts: FontData[] | null | undefined;

async function fetchFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, {
      // Long revalidate — Google's font URLs are content-addressed and
      // effectively immutable, so a stale cache is fine.
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

async function loadOGFonts(): Promise<FontData[] | null> {
  if (cachedFonts !== undefined) return cachedFonts;
  // next/og's satori engine only supports TTF/OTF, not WOFF2 — so we
  // fetch straight from each font's upstream repo. These URLs are
  // content-addressed and effectively immutable.
  const [interBold, interExtraBold, sarabunBold] = await Promise.all([
    fetchFont("https://github.com/rsms/inter/raw/v4.0/docs/font-files/Inter-Bold.ttf"),
    fetchFont("https://github.com/rsms/inter/raw/v4.0/docs/font-files/Inter-ExtraBold.ttf"),
    fetchFont("https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Bold.ttf"),
  ]);
  const out: FontData[] = [];
  if (interBold) out.push({ name: "Inter", data: interBold, weight: 700 });
  if (interExtraBold) out.push({ name: "Inter", data: interExtraBold, weight: 800 });
  if (sarabunBold) out.push({ name: "Sarabun", data: sarabunBold, weight: 700 });
  cachedFonts = out.length > 0 ? out : null;
  return cachedFonts;
}

// Values map 1:1 to Tailwind tokens so the palette stays in sync.
const COLOR = {
  navy900: "#0f172a",
  navy700: "#334155",
  navy400: "#94a3b8",
  navy100: "#e2e8f0",
  accent400: "#a78bfa",
  accent600: "#7c3aed",
  white: "#ffffff",
};

export async function renderOG(args: {
  title: string;
  kicker?: string;
  subtitle?: string;
  locale?: "en" | "th";
}) {
  const { title, kicker, subtitle, locale = "en" } = args;

  // Rough title fitting — Next's ImageResponse doesn't measure text so
  // we clamp the font size on longer titles. Anything above ~80 chars
  // (a length threshold that survives most real service/case names) drops
  // a size tier so it doesn't overflow the safe area.
  let titleSize = 88;
  if (title.length > 40) titleSize = 72;
  if (title.length > 65) titleSize = 60;

  const fonts = await loadOGFonts();
  const primaryFamily = locale === "th"
    ? "'Sarabun', 'Inter', system-ui, sans-serif"
    : "'Inter', 'Sarabun', system-ui, sans-serif";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          background: `linear-gradient(135deg, ${COLOR.navy900} 0%, ${COLOR.accent600} 100%)`,
          color: COLOR.white,
          fontFamily: primaryFamily,
        }}
      >
        {/* Header row — brand mark + tagline */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: COLOR.white,
              color: COLOR.navy900,
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: -1,
            }}
          >
            F2
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>F2 Co., Ltd.</div>
            <div style={{ fontSize: 18, color: COLOR.navy100 }}>
              {locale === "th" ? "ไอทีสำหรับโรงแรมและวิลล่าในไทย" : "Hospitality-grade IT · Thailand"}
            </div>
          </div>
        </div>

        {/* Kicker — small uppercase label */}
        {kicker && (
          <div
            style={{
              marginTop: 72,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: COLOR.accent400,
            }}
          >
            {kicker}
          </div>
        )}

        {/* Title */}
        <div
          style={{
            marginTop: kicker ? 16 : 96,
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -1,
            // Multi-line clamp — three lines is the practical maximum at 88pt.
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              marginTop: 24,
              fontSize: 28,
              lineHeight: 1.3,
              color: COLOR.navy100,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Footer — URL. `marginTop: auto` pushes to the bottom edge. */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 22,
            color: COLOR.navy100,
          }}
        >
          <div>f2.co.th</div>
          <div style={{ color: COLOR.accent400 }}>
            {locale === "th" ? "→ ปรึกษาเรา" : "→ Talk to F2"}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      // ImageResponse.fonts is optional — if the Google Fonts fetch fell
      // through (offline dev machine, network hiccup), we simply render
      // with system fonts. Never let a broken font bring the endpoint down.
      fonts: fonts ?? undefined,
    },
  );
}
