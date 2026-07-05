"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, ChevronLeft, Check, X, MinusCircle, Circle, ChevronDown, ChevronRight } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalProjectBoard, type PortalProjectItem, type PortalItemStatus } from "@/lib/portal-api";

export default function PortalProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell>
      <Detail id={id} />
    </PortalShell>
  );
}

function Detail({ id }: { id: string }) {
  const t = useTranslations("portal.projects");
  const tc = useTranslations("common");
  const [board, setBoard] = useState<PortalProjectBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi.getMyProjectBoard(id)
      .then(setBoard)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>;
  }
  if (!board) return <div className="card text-center text-navy-500">{t("notFound")}</div>;

  const total = board.modules.reduce((s, m) => s + m.items.length, 0);
  const done = board.modules.reduce((s, m) => s + m.items.filter((it) => it.status !== "pending").length, 0);

  return (
    <div>
      <header className="mb-6">
        <Link href="/portal/projects" className="mb-2 inline-flex items-center gap-1 text-sm text-navy-600 hover:text-navy-900">
          <ChevronLeft className="h-4 w-4" /> {t("backToList")}
        </Link>
        <h1 className="font-display text-3xl text-navy-900">{board.project.name}</h1>
        <p className="mt-1 text-sm text-navy-600">
          {t("progress")}: {done} / {total}
        </p>
      </header>
      <div className="space-y-3">
        {board.modules.map((m) => (
          <ModuleSection key={m.id} name_en={m.name_en} name_th={m.name_th} code={m.code} items={m.items} />
        ))}
      </div>
    </div>
  );
}

function ModuleSection({ code, name_en, name_th, items }: {
  code: string; name_en: string; name_th: string; items: PortalProjectItem[];
}) {
  const [expanded, setExpanded] = useState(true);
  const done = items.filter((it) => it.status !== "pending").length;
  return (
    <section className="card p-0 overflow-hidden">
      <button onClick={() => setExpanded((x) => !x)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-navy-50">
        {expanded ? <ChevronDown className="h-4 w-4 text-navy-500" /> : <ChevronRight className="h-4 w-4 text-navy-500" />}
        <span className="font-mono text-xs text-navy-400">{code}</span>
        <div className="min-w-0 flex-1 text-left">
          <p className="font-medium text-navy-900">{name_en}</p>
          <p className="text-xs text-navy-500">{name_th}</p>
        </div>
        <span className="text-xs text-navy-500">{done} / {items.length}</span>
      </button>
      {expanded && (
        <ul className="divide-y divide-navy-100">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3 p-3">
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colorFor(it.status)}`}>
                {iconFor(it.status)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-navy-900">{it.text_en}</p>
                <p className="text-xs text-navy-500">{it.text_th}</p>
                {it.note && <p className="mt-1 text-xs text-navy-600">— {it.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function colorFor(s: PortalItemStatus) {
  switch (s) {
    case "pass": return "bg-emerald-100 text-emerald-800";
    case "fail": return "bg-red-100 text-red-800";
    case "na": return "bg-navy-100 text-navy-600";
    default: return "bg-navy-50 text-navy-400";
  }
}

function iconFor(s: PortalItemStatus) {
  switch (s) {
    case "pass": return <Check className="h-4 w-4" />;
    case "fail": return <X className="h-4 w-4" />;
    case "na": return <MinusCircle className="h-4 w-4" />;
    default: return <Circle className="h-4 w-4" />;
  }
}
