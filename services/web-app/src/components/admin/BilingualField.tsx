// BilingualField — the canonical EN + TH content editor primitive.
//
// Replaces the per-editor locale-toggle pattern that had been copy-pasted
// into CaseStudyEditor, ServiceEditor, BlogEditor, and PageEditor.
//
// Responsive behaviour:
//   • Desktop (sm+): both languages render side-by-side so authors can
//     compare and translate without switching contexts.
//   • Mobile (< sm): only one language shows at a time; the shared
//     <BilingualEditor> wrapper renders a mobile-only EN/TH toggle at
//     the top of the section that all child fields respect. This avoids
//     the "scroll past 20 rows of EN to reach 20 rows of TH" problem
//     that vertical stacking causes on narrow viewports.
//
// The mobile toggle is invisible on desktop, and the language-switcher
// in the admin shell's top-right stays what it always was (admin UI
// language) so the two concerns never collide.
//
// See memory: [[feedback-extract-first-design]] and
// [[reference-shared-components]] before adding any new bilingual editor.

"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// ---------- Context ----------

type ContentLocale = "en" | "th";
type Ctx = {
  mobileLocale: ContentLocale;
  setMobileLocale: (v: ContentLocale) => void;
};

const BilingualCtx = createContext<Ctx | null>(null);

function useMobileLocale(): ContentLocale {
  const ctx = useContext(BilingualCtx);
  // No provider → default to EN on mobile (fields still render both on
  // desktop via the sm: media query below).
  return ctx?.mobileLocale ?? "en";
}

// ---------- Wrapper ----------

/**
 * Wrap the bilingual section of an editor with this. On mobile it
 * renders a single EN/TH toggle at the top; on desktop the toggle
 * is hidden. Any `<BilingualInput>` / `<BilingualTextArea>` inside
 * respects the toggle on mobile and shows both languages on desktop.
 */
export function BilingualEditor({
  children,
  initialLocale = "en",
  className,
}: {
  children: ReactNode;
  initialLocale?: ContentLocale;
  className?: string;
}) {
  const [mobileLocale, setMobileLocale] = useState<ContentLocale>(initialLocale);
  return (
    <BilingualCtx.Provider value={{ mobileLocale, setMobileLocale }}>
      <div className={className}>
        {/* Mobile-only toggle. `sm:hidden` keeps it out of the desktop
            layout where both languages are already visible. */}
        <div className="sm:hidden mb-4 flex rounded-lg border border-navy-200 overflow-hidden bg-white">
          {(["en", "th"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setMobileLocale(l)}
              className={`flex-1 px-4 py-2 text-sm font-medium ${
                mobileLocale === l
                  ? "bg-navy-900 text-white"
                  : "text-navy-600 hover:bg-navy-50"
              }`}
              aria-pressed={mobileLocale === l}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        {children}
      </div>
    </BilingualCtx.Provider>
  );
}

// ---------- Field primitives ----------

type CommonProps = {
  label: string;
  /** Optional per-language helper (falls back to `helper` for both). */
  helperEN?: ReactNode;
  helperTH?: ReactNode;
  helper?: ReactNode;
  /** Placeholder shown in the EN input. */
  placeholderEN?: string;
  /** Placeholder shown in the TH input. Defaults to placeholderEN. */
  placeholderTH?: string;
  /** Mark the EN field as required in HTML validation + label. */
  required?: boolean;
  /** Restrict input length for both languages. */
  maxLength?: number;
  /** Render the inputs in monospace — useful for markdown bodies. */
  mono?: boolean;
  /** Bound values. */
  en: string;
  th: string;
  /** Change handlers. */
  onEN: (v: string) => void;
  onTH: (v: string) => void;
};

function FieldLabel({
  label,
  language,
  required,
}: {
  label: string;
  language: "EN" | "TH";
  required?: boolean;
}) {
  return (
    <label className="block text-xs font-medium text-navy-600 mb-1">
      <span className="uppercase tracking-wider">{label}</span>{" "}
      <span className="text-navy-400">({language})</span>
      {required && language === "EN" && (
        <span aria-hidden className="ml-0.5 text-red-500">*</span>
      )}
    </label>
  );
}

const inputBase =
  "w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none";

/** Show/hide class for the two language columns based on mobile toggle. */
function laneClass(myLang: ContentLocale, mobileLocale: ContentLocale) {
  return myLang === mobileLocale ? "" : "hidden sm:block";
}

/** Single-line bilingual field. */
export function BilingualInput(props: CommonProps) {
  const {
    label, helperEN, helperTH, helper,
    placeholderEN, placeholderTH,
    required, maxLength, mono,
    en, th, onEN, onTH,
  } = props;
  const mobileLocale = useMobileLocale();
  const cls = mono ? `${inputBase} font-mono` : inputBase;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className={laneClass("en", mobileLocale)}>
        <FieldLabel label={label} language="EN" required={required} />
        <input
          type="text"
          value={en}
          onChange={(e) => onEN(e.target.value)}
          placeholder={placeholderEN}
          required={required}
          maxLength={maxLength}
          className={cls}
        />
        {(helperEN ?? helper) && (
          <p className="mt-1 text-[11px] text-navy-500">{helperEN ?? helper}</p>
        )}
      </div>
      <div className={laneClass("th", mobileLocale)}>
        <FieldLabel label={label} language="TH" />
        <input
          type="text"
          value={th}
          onChange={(e) => onTH(e.target.value)}
          placeholder={placeholderTH ?? placeholderEN}
          maxLength={maxLength}
          className={cls}
        />
        {(helperTH ?? helper) && (
          <p className="mt-1 text-[11px] text-navy-500">{helperTH ?? helper}</p>
        )}
      </div>
    </div>
  );
}

/** Multi-line bilingual field. Both languages share the same row count. */
export function BilingualTextArea(props: CommonProps & { rows?: number }) {
  const {
    label, helperEN, helperTH, helper,
    placeholderEN, placeholderTH,
    required, maxLength, mono, rows = 4,
    en, th, onEN, onTH,
  } = props;
  const mobileLocale = useMobileLocale();
  const cls = mono ? `${inputBase} font-mono` : inputBase;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className={laneClass("en", mobileLocale)}>
        <FieldLabel label={label} language="EN" required={required} />
        <textarea
          value={en}
          onChange={(e) => onEN(e.target.value)}
          placeholder={placeholderEN}
          required={required}
          maxLength={maxLength}
          rows={rows}
          className={cls}
        />
        {(helperEN ?? helper) && (
          <p className="mt-1 text-[11px] text-navy-500">{helperEN ?? helper}</p>
        )}
      </div>
      <div className={laneClass("th", mobileLocale)}>
        <FieldLabel label={label} language="TH" />
        <textarea
          value={th}
          onChange={(e) => onTH(e.target.value)}
          placeholder={placeholderTH ?? placeholderEN}
          maxLength={maxLength}
          rows={rows}
          className={cls}
        />
        {(helperTH ?? helper) && (
          <p className="mt-1 text-[11px] text-navy-500">{helperTH ?? helper}</p>
        )}
      </div>
    </div>
  );
}
