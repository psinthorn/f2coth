// Next.js dynamic apple-touch-icon at /apple-icon.png. iOS home-screen
// icons don't respect maskable padding, so this file uses the same
// letterform but WITHOUT the rounded border-radius — iOS masks it.
//
// 180×180 is Apple's canonical size for iPhone 6+ and later.

import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0f172a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          fontWeight: 800,
          fontSize: 100,
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
