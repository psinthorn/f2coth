"use client";

// MarkdownEditor — a deliberately minimal markdown input used across admin
// forms (ticket issue / solution / notes / replies). It is NOT a full WYSIWYG:
// it's a plain <textarea> plus a small toolbar that inserts markdown syntax
// around the current selection, and a Write/Preview toggle that renders the
// same `marked` pipeline used everywhere else (via CMSPageBody).
//
// Reusable primitive — check src/components before adding another rich-text
// input. Toolbar set is intentionally fixed: bold, italic, bulleted list,
// link, inline code. Keep it small; tickets don't need tables or images.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bold, Italic, List, Link2, Code, Eye, Pencil } from "lucide-react";
import CMSPageBody from "@/components/CMSPageBody";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  id?: string;
  disabled?: boolean;
};

export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 8,
  maxLength = 10000,
  id,
  disabled,
}: Props) {
  const tm = useTranslations("common.markdown");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  // Re-select the affected text after a programmatic edit so the user can keep
  // typing / chaining formatting. Runs on the next tick once React has painted.
  function applySelection(next: string, selStart: number, selEnd: number) {
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  // Wrap the current selection with `before`/`after`. With no selection, drops
  // the markers in place and puts the caret between them.
  function wrap(before: string, after: string, placeholderText = "") {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    applySelection(next, start + before.length, start + before.length + selected.length);
  }

  // Prefix every line touched by the selection (for bulleted lists).
  function prefixLines(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const replaced = block
      .split("\n")
      .map((l) => (l.startsWith(prefix) ? l : prefix + l))
      .join("\n");
    const next = value.slice(0, lineStart) + replaced + value.slice(end);
    applySelection(next, lineStart, lineStart + replaced.length);
  }

  function link() {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = value.slice(start, end) || tm("linkText");
    const inserted = `[${text}](url)`;
    const next = value.slice(0, start) + inserted + value.slice(end);
    // Select the "url" placeholder so the user can type the destination.
    const urlStart = start + text.length + 3;
    applySelection(next, urlStart, urlStart + 3);
  }

  const tools = [
    { key: "bold", Icon: Bold, run: () => wrap("**", "**", tm("boldText")) },
    { key: "italic", Icon: Italic, run: () => wrap("*", "*", tm("italicText")) },
    { key: "list", Icon: List, run: () => prefixLines("- ") },
    { key: "link", Icon: Link2, run: link },
    { key: "code", Icon: Code, run: () => wrap("`", "`", tm("codeText")) },
  ] as const;

  return (
    <div className="rounded-lg border border-navy-200 focus-within:border-accent-500">
      <div className="flex items-center justify-between border-b border-navy-100 px-1.5 py-1">
        <div className="flex items-center gap-0.5">
          {tools.map(({ key, Icon, run }) => (
            <button
              key={key}
              type="button"
              onClick={run}
              disabled={disabled || preview}
              title={tm(key)}
              aria-label={tm(key)}
              className="rounded p-1.5 text-navy-600 hover:bg-navy-100 hover:text-navy-900 disabled:opacity-40"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-navy-600 hover:bg-navy-100 hover:text-navy-900"
        >
          {preview ? (
            <>
              <Pencil className="h-3 w-3" /> {tm("write")}
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" /> {tm("preview")}
            </>
          )}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[6rem] px-3 py-2">
          {value.trim() ? (
            <CMSPageBody markdown={value} />
          ) : (
            <p className="text-sm italic text-navy-400">{tm("nothingToPreview")}</p>
          )}
        </div>
      ) : (
        <textarea
          id={id}
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full resize-y rounded-b-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-60"
        />
      )}
    </div>
  );
}
