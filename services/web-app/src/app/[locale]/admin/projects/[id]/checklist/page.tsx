"use client";

import React, { use, useCallback, useContext, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Check, X, MinusCircle, Circle, ChevronLeft, ChevronDown, ChevronRight, Camera } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { checklistApi, type ItemStatus, type ProjectBoard, type ProjectItem } from "@/lib/checklist-api";

const nextStatus: Record<ItemStatus, ItemStatus> = {
  pending: "pass",
  pass: "fail",
  fail: "na",
  na: "pending",
};

export default function AdminProjectChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AdminShell>
      <ChecklistView projectId={id} />
    </AdminShell>
  );
}

// React context to plumb projectId into ItemRow without prop-drilling
// through ModuleSection.
const ProjectIdContext = React.createContext<string>("");

function ChecklistView({ projectId }: { projectId: string }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checklistApi.getBoard(projectId)
      .then((b) => setBoard(b))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const patch = useCallback((itemId: string, updates: Partial<ProjectItem>) => {
    setBoard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        modules: prev.modules.map((m) => ({
          ...m,
          items: m.items.map((it) => (it.id === itemId ? { ...it, ...updates } : it)),
        })),
      };
    });
  }, []);

  if (loading) {
    return <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>;
  }
  if (!board) return <div className="card text-center text-navy-500">{t("board.notFound")}</div>;

  return (
    <div>
      <header className="mb-6">
        <Link href={`/admin/projects/${projectId}` as any} className="mb-2 inline-flex items-center gap-1 text-sm text-navy-600 hover:text-navy-900">
          <ChevronLeft className="h-4 w-4" /> {t("board.backToBoard")}
        </Link>
        <h1 className="font-display text-3xl text-navy-900">{board.project.name}</h1>
        <p className="text-sm text-navy-600">{t("checklist.subtitle")}</p>
      </header>
      <ProjectIdContext.Provider value={projectId}>
        <div className="space-y-3">
          {board.modules.map((m) => (
            <ModuleSection key={m.id} name_en={m.name_en} name_th={m.name_th} code={m.code} items={m.items} onPatch={patch} />
          ))}
        </div>
      </ProjectIdContext.Provider>
    </div>
  );
}

function ModuleSection({
  code, name_en, name_th, items, onPatch,
}: {
  code: string; name_en: string; name_th: string; items: ProjectItem[];
  onPatch: (id: string, u: Partial<ProjectItem>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const done = items.filter((it) => it.status !== "pending").length;
  return (
    <section className="card p-0 overflow-hidden">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center gap-3 px-4 py-3 hover:bg-navy-50"
      >
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
          {items.map((it) => <ItemRow key={it.id} item={it} onPatch={onPatch} />)}
        </ul>
      )}
    </section>
  );
}

function ItemRow({ item, onPatch }: { item: ProjectItem; onPatch: (id: string, u: Partial<ProjectItem>) => void }) {
  const t = useTranslations("admin.projects");
  const [note, setNote] = useState(item.note ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const projectId = useContext(ProjectIdContext);

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await checklistApi.uploadPhoto(file, projectId || undefined);
      await checklistApi.updateItem(item.id, { photo_url: url });
      onPatch(item.id, { photo_url: url });
    } catch {
      // silent; the UI just doesn't reflect the change
    } finally {
      setUploading(false);
    }
  };

  const cycle = async () => {
    const target = nextStatus[item.status];
    onPatch(item.id, { status: target });
    setSaving(true);
    try {
      await checklistApi.updateItem(item.id, { status: target });
    } catch {
      onPatch(item.id, { status: item.status });
    } finally {
      setSaving(false);
    }
  };

  const saveNote = async () => {
    if (note === (item.note ?? "")) return;
    setSaving(true);
    try {
      await checklistApi.updateItem(item.id, { note });
      onPatch(item.id, { note });
    } catch {
      setNote(item.note ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
      <button
        onClick={cycle}
        disabled={saving}
        data-testid={`status-${item.id}`}
        aria-label={`status: ${item.status}`}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${statusColor(item.status)}`}
      >
        {statusIcon(item.status)}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-navy-900">{item.text_en}</p>
        <p className="text-xs text-navy-500">{item.text_th}</p>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          placeholder={t("checklist.notePlaceholder")}
          className="mt-2 w-full rounded-lg border border-navy-100 px-2 py-1 text-xs focus:border-accent-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <label className={`inline-flex items-center gap-1 text-xs cursor-pointer ${uploading ? "text-navy-400" : "text-accent-600 hover:text-accent-700"}`}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            {uploading ? t("checklist.uploading") : t("checklist.attachPhoto")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
                e.target.value = "";
              }}
            />
          </label>
          {item.photo_url && (
            <a href={item.photo_url} target="_blank" rel="noreferrer" className="text-xs text-accent-600 underline">
              {t("checklist.viewPhoto")}
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function statusColor(s: ItemStatus) {
  switch (s) {
    case "pass": return "bg-emerald-100 text-emerald-800";
    case "fail": return "bg-red-100 text-red-800";
    case "na": return "bg-navy-100 text-navy-600";
    default: return "bg-navy-50 text-navy-400";
  }
}

function statusIcon(s: ItemStatus) {
  switch (s) {
    case "pass": return <Check className="h-4 w-4" />;
    case "fail": return <X className="h-4 w-4" />;
    case "na": return <MinusCircle className="h-4 w-4" />;
    default: return <Circle className="h-4 w-4" />;
  }
}
