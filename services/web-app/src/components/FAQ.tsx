// Shared FAQ block — renders visible <details> Q&A pairs AND emits
// FAQPage JSON-LD schema so Google AI Overviews + generative search
// engines can extract the answers directly.
//
// Server component: purely SSR, no client JS needed. `<details>` gives
// native progressive-disclosure without React state.
//
// Callers pass:
//   • items — the Q/A array (comes from services.faq JSONB or a hardcoded
//             constant on non-CMS pages).
//   • heading — localized section heading (usually "Frequently asked
//             questions" / "คำถามที่พบบ่อย").
//
// Renders nothing (including no schema) when items is empty — keeps the
// FAQPage schema honest and avoids "faq section" chrome on pages that
// aren't ready.

import type { FAQItem } from "@/lib/api";
import { JsonLd, faqPage } from "@/lib/schema";

export function FAQ({ items, heading }: { items: FAQItem[]; heading: string }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="container-page py-16">
      <JsonLd data={faqPage(items.map((i) => ({ question: i.q, answer: i.a })))} />
      <h2 className="font-display text-2xl text-navy-900">{heading}</h2>
      <div className="mt-6 divide-y divide-navy-100 rounded-xl border border-navy-100 bg-white">
        {items.map((item, idx) => (
          <details key={idx} className="group p-5 open:bg-navy-50/40">
            <summary className="flex cursor-pointer items-start justify-between gap-4 font-medium text-navy-900 list-none">
              <span>{item.q}</span>
              <span className="mt-1 text-navy-400 transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 text-navy-700">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
