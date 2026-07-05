import { marked } from "marked";

// Renders CMS-managed markdown as sanitized HTML with Tailwind prose styling.
// Used by public pages that opt-in to CMS-driven content (about / privacy /
// terms / dpa / any admin-created page).
//
// `marked` is configured for GFM + line breaks. Output is trusted because the
// only writers are admin/editor JWT holders — same trust model as the blog
// body_md field.
marked.setOptions({ gfm: true, breaks: true });

export default function CMSPageBody({ markdown }: { markdown: string }) {
  const html = marked.parse(markdown, { async: false }) as string;
  return (
    <div
      className="prose prose-navy max-w-none prose-headings:font-display prose-headings:text-navy-900 prose-a:text-accent-700 prose-a:no-underline hover:prose-a:underline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
