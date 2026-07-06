// Next.js dynamic icon at /icon.png (Android + PWA install). Rendered at
// build time via ImageResponse — no static asset to keep in /public and
// no manual PNG export. If F2 brand ever ships a custom SVG, drop it here.
//
// Design: 512×512 PNG, navy-900 background, white F2 letterform in the
// same slab display face used across the site (Playfair Display /
// font-display). Matches the header logo tile shape (rounded square).

import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0f172a", // navy-900
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 96, // rounded so it looks intentional under
                            // maskable safe-zone masks too
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          fontWeight: 800,
          fontSize: 280,
          letterSpacing: "-0.05em",
          lineHeight: 1,
        }}
      >
        F2
      </div>
    ),
    { ...size },
  );
}
