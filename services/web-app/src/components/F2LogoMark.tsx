// F2 wordmark — clean F+F ligature drawn as inline SVG paths so callers
// control colour via `currentColor` and never have to fetch an image.
// Pair it with the navy tile wrapper the site's shells already use, e.g.:
//
//   <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy-800 text-white">
//     <F2LogoMark className="h-5 w-5" />
//   </span>
//
// The same shape is also served statically at:
//   /icon.svg          — favicon + PWA manifest (Chrome/Edge/Firefox/Safari)
//   /apple-icon.png    — iOS home-screen touch icon (180×180)
//   /brand/f2-mark.svg — canonical source (mirrored to src/app/icon.svg)
//   /brand/f2-logo.jpg — full-colour marketing composite (keyword grid)

import type { SVGProps } from "react";

export default function F2LogoMark({
  title = "F2 Co., Ltd.",
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 240"
      role="img"
      aria-label={title}
      fill="currentColor"
      {...props}
    >
      <title>{title}</title>
      {/* Left F: left stem + top bar + middle bar */}
      <path d="M 24 24 L 128 24 L 128 62 L 62 62 L 62 100 L 118 100 L 118 138 L 62 138 L 62 216 L 24 216 Z" />
      {/* Right mirrored F (Ǝ): right stem + top bar + middle bar,
          positioned to interlock with the left F through the shared centre. */}
      <path d="M 216 24 L 112 24 L 112 62 L 178 62 L 178 100 L 122 100 L 122 138 L 178 138 L 178 216 L 216 216 Z" />
    </svg>
  );
}
