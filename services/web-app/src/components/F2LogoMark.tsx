// F2 Co., Ltd. logo — the official brand mark ships with its own
// background (F+F letterform overlaid on a keyword collage), so this
// component just serves the source JPEG. Callers control the tile size
// and shape via `className` (typically `h-N w-N rounded-lg` on shells,
// bigger on splash/login pages) and DO NOT wrap it in a coloured tile —
// the JPEG's own background is intentional and should not be framed.
//
// Assets:
//   /brand/f2-logo.jpg — source of truth, 789×789 JPEG
//   /brand/f2-mark.svg — clean SVG replica kept for future icon-only
//     surfaces where a monochrome mark makes more sense (favicon,
//     watermark, PDF header). Not used by this component.

import type { ImgHTMLAttributes } from "react";

export default function F2LogoMark({
  alt = "F2 Co., Ltd.",
  className,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  return (
    // Plain <img> rather than next/image: this component is used inside
    // several client components and shells where prop-passing a fixed
    // width/height fights with utility-class sizing. The asset is <60 KB,
    // served from /public, cached by the SW.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/f2-logo.jpg"
      alt={alt}
      className={className}
      {...props}
    />
  );
}
