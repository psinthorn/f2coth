// Top-level 404. Renders without i18n context, since unmatched routes never
// reach setRequestLocale in [locale]/layout.tsx. The translated variant at
// [locale]/not-found.tsx is reserved for explicit notFound() calls inside
// the locale segment.
export default function NotFound() {
  return (
    <section className="container-page py-24 text-center">
      <p className="font-display text-7xl text-accent-600">404</p>
      <h1 className="mt-4 font-display text-3xl text-navy-900">Page not found</h1>
      <p className="mt-3 text-navy-600">The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.</p>
      <a href="/" className="mt-8 inline-flex btn-accent">Back to home</a>
    </section>
  );
}
