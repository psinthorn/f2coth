// Next.js App Router native manifest route. Served at /manifest.webmanifest
// with Content-Type: application/manifest+json. Rendered as pure static JSON
// at build time (no runtime cost).
//
// PWA installability requires: name, short_name, start_url, display, icons
// (min 192×192 + 512×512), and either background_color or theme_color.
// Chromium also requires the manifest to be reachable over HTTPS in prod
// (Traefik terminates TLS in the docker-compose stack) OR served from
// localhost during dev — either works for install testing.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "F2 Co., Ltd.",
    short_name: "F2",
    description:
      "F2 Co., Ltd. — Thailand's trusted IT partner for luxury hospitality. Domain, hosting, IT management, and AI operations for hotels, villas, and resorts.",
    start_url: "/",
    // scope tells the OS which URLs belong to this app. Broad scope so
    // Traefik-routed admin/portal/api URLs all stay inside the installed
    // window instead of opening the browser.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    // navy-900 from tailwind.config.ts — matches the header + admin shell
    theme_color: "#0f172a",
    lang: "en",
    dir: "ltr",
    categories: ["business", "productivity"],
    // Icons: reference the Next.js dynamic routes at app/icon.tsx and
    // app/apple-icon.tsx (see those files for the F2 letterform SVG
    // rendering). Next produces PNGs at build time. The purpose=any
    // maskable icon is required by Android/Chrome for adaptive icons.
    icons: [
      // Static SVG for anything modern (Chrome, Edge, Firefox, Safari
      // 16+). sizes="any" tells the browser to scale the vector — no
      // fallback bitmap needed at each PWA size. Next.js auto-serves
      // src/app/icon.svg at /icon.svg.
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      // Static PNG at 180×180 for iOS home-screen (iOS ignores the PWA
      // manifest for icons and uses <link rel="apple-touch-icon">
      // instead, but adding it here keeps parity across platforms).
      // Next.js auto-serves src/app/apple-icon.png at /apple-icon.png.
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    // App-shortcuts land in the OS long-press menu on the installed icon.
    // Kept short — F2 staff install this on tablets they carry on site
    // visits, so these should be the two things they open most often.
    shortcuts: [
      {
        name: "New ticket",
        short_name: "Ticket",
        url: "/admin/tickets/new",
        description: "Create a support ticket on behalf of a customer",
      },
      {
        name: "Admin dashboard",
        short_name: "Admin",
        url: "/admin",
        description: "Open the F2 admin console",
      },
    ],
  };
}
