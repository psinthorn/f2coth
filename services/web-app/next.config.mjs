import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // camera + geolocation are needed by AttachmentUploader's "Take
    // photo" flow (device camera capture + navigator.geolocation for
    // GPS-tagged site photos). Allow same-origin only. microphone stays
    // off — we don't record audio anywhere. interest-cohort off blocks
    // FLoC tracking.
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self), interest-cohort=()",
  },
  // Content-Security-Policy is set per-request in middleware.ts using a
  // cryptographic nonce, eliminating 'unsafe-inline' for script-src.
];

// Public-only build (Vercel): admin + portal + payments redirect to the
// full-stack deployment at admin.f2.co.th. Toggle with PUBLIC_ONLY_BUILD=1.
const PUBLIC_ONLY = process.env.PUBLIC_ONLY_BUILD === "1";
const BACKOFFICE_HOST =
  process.env.BACKOFFICE_HOST ?? "https://admin.f2.co.th";

const nextConfig = {
  reactStrictMode: true,
  // `standalone` is used by the Docker Dockerfile. Vercel ignores it, but
  // omit it in Vercel builds to avoid duplicate .next/standalone output.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "f2.co.th" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    if (!PUBLIC_ONLY) return [];
    // 307 (temporary) so we can flip PUBLIC_ONLY off later without
    // clients caching a permanent redirect.
    return [
      {
        source: "/:locale(en|th)/admin/:path*",
        destination: `${BACKOFFICE_HOST}/:locale/admin/:path*`,
        permanent: false,
      },
      {
        source: "/admin/:path*",
        destination: `${BACKOFFICE_HOST}/admin/:path*`,
        permanent: false,
      },
      {
        source: "/:locale(en|th)/portal/:path*",
        destination: `${BACKOFFICE_HOST}/:locale/portal/:path*`,
        permanent: false,
      },
      {
        source: "/portal/:path*",
        destination: `${BACKOFFICE_HOST}/portal/:path*`,
        permanent: false,
      },
      {
        source: "/:locale(en|th)/payments/:path*",
        destination: `${BACKOFFICE_HOST}/:locale/payments/:path*`,
        permanent: false,
      },
      {
        source: "/payments/:path*",
        destination: `${BACKOFFICE_HOST}/payments/:path*`,
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
