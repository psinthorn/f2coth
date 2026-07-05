"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2, X, GripVertical, ClipboardList, FileText } from "lucide-react";
import {
  checklistApi,
  type Project,
  type ProjectBoard as BoardData,
  type ProjectModule,
  type Template,
} from "@/lib/checklist-api";

// Board is a two-panel drag-drop layout: library on the left (draggable),
// project modules on the right (sortable). We use two DndContexts nested
// under one, with data.type distinguishing "library" vs "attached" so a
// single onDragEnd can handle both attach and reorder.

type DragKind = "library" | "attached";

export default function ProjectBoard({ projectId }: { projectId: string }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDrag, setActiveDrag] = useState<{ kind: DragKind; id: string } | null>(null);

  useEffect(() => {
    Promise.all([checklistApi.getBoard(projectId), checklistApi.listTemplates()])
      .then(([b, t]) => {
        setBoard(b);
        setTemplates(t.templates ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const attachedTemplateIds = useMemo(
    () => new Set((board?.modules ?? []).map((m) => m.template_id)),
    [board],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const attachModule = useCallback(async (templateId: string) => {
    if (!board) return;
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    // Optimistic insert; the real ID + items come back on refresh.
    const tempPmId = `pending-${Math.random().toString(36).slice(2)}`;
    const optimistic: ProjectModule = {
      id: tempPmId,
      project_id: projectId,
      template_id: template.id,
      code: template.code,
      name_en: template.name_en,
      name_th: template.name_th,
      icon: template.icon,
      position: board.modules.length,
      added_by: null,
      added_at: new Date().toISOString(),
      items: [],
    };
    setBoard({ ...board, modules: [...board.modules, optimistic] });
    try {
      await checklistApi.attachModule(projectId, templateId);
      const fresh = await checklistApi.getBoard(projectId);
      setBoard(fresh);
    } catch {
      setBoard({ ...board, modules: board.modules.filter((m) => m.id !== tempPmId) });
    }
  }, [board, projectId, templates]);

  const detachModule = useCallback(async (pmId: string) => {
    if (!board) return;
    if (!window.confirm(t("board.confirmDetach"))) return;
    const snapshot = board.modules;
    setBoard({ ...board, modules: board.modules.filter((m) => m.id !== pmId) });
    try {
      await checklistApi.detachModule(projectId, pmId);
    } catch {
      setBoard({ ...board, modules: snapshot });
    }
  }, [board, projectId, t]);

  const onDragStart = (e: DragStartEvent) => {
    const kind = (e.active.data.current?.kind as DragKind) ?? "attached";
    setActiveDrag({ kind, id: String(e.active.id) });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveDrag(null);
    const activeKind = (e.active.data.current?.kind as DragKind) ?? "attached";
    const overID = e.over?.id ? String(e.over.id) : null;
    if (!overID || !board) return;

    if (activeKind === "library") {
      const templateId = String(e.active.id);
      if (attachedTemplateIds.has(templateId)) return;
      await attachModule(templateId);
      return;
    }

    // reorder within attached
    if (activeKind === "attached" && overID !== e.active.id) {
      const oldIndex = board.modules.findIndex((m) => m.id === e.active.id);
      const newIndex = board.modules.findIndex((m) => m.id === overID);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(board.modules, oldIndex, newIndex);
      setBoard({ ...board, modules: next });
      try {
        await checklistApi.reorderModules(projectId, next.map((m) => m.id));
      } catch {
        setBoard({ ...board, modules: board.modules });
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-navy-500">
        <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
      </div>
    );
  }
  if (!board) {
    return <div className="card text-center text-navy-500">{t("board.notFound")}</div>;
  }

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-navy-500">
            {board.project.customer_name ?? board.project.client_name}
            {board.project.customer_id ? (
              <Link href={`/admin/customers/${board.project.customer_id}` as any} className="ml-2 text-accent-600 hover:underline">
                {t("board.viewCustomer")}
              </Link>
            ) : null}
          </p>
          <h1 className="font-display text-3xl text-navy-900">{board.project.name}</h1>
          <VisibilityToggle project={board.project} onChange={(v) => setBoard({ ...board, project: { ...board.project, visible_to_customer: v } })} />
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/projects/${board.project.id}/checklist` as any}
            className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-medium text-navy-800 hover:bg-navy-50"
          >
            <ClipboardList className="mr-1 inline h-4 w-4" /> {t("board.openChecklist")}
          </Link>
          <Link
            href={`/admin/projects/${board.project.id}/report` as any}
            className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-medium text-navy-800 hover:bg-navy-50"
          >
            <FileText className="mr-1 inline h-4 w-4" /> {t("board.report")}
          </Link>
        </div>
      </header>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <ModuleLibrary
            templates={templates}
            attachedIds={attachedTemplateIds}
          />
          <AttachedList
            modules={board.modules}
            onDetach={detachModule}
          />
        </div>
        <DragOverlay>
          {activeDrag ? <DragPreview kind={activeDrag.kind} id={activeDrag.id} board={board} templates={templates} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ─────────── Library panel (draggable source) ───────────

function ModuleLibrary({ templates, attachedIds }: { templates: Template[]; attachedIds: Set<string> }) {
  const t = useTranslations("admin.projects");
  return (
    <aside className="card sticky top-4 h-fit" data-testid="module-library">
      <h2 className="mb-3 font-medium text-navy-900">{t("board.library")}</h2>
      <p className="mb-3 text-xs text-navy-500">{t("board.libraryHint")}</p>
      <ul className="space-y-2">
        {templates.map((tpl) => (
          <LibraryCard key={tpl.id} template={tpl} attached={attachedIds.has(tpl.id)} />
        ))}
      </ul>
    </aside>
  );
}

function LibraryCard({ template, attached }: { template: Template; attached: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: template.id,
    data: { kind: "library" satisfies DragKind },
    disabled: attached,
  });
  const style = { transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.4 : 1 };
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`library-card-${template.code}`}
      className={`flex items-start gap-2 rounded-lg border border-navy-100 p-2 text-sm ${
        attached ? "bg-navy-50 text-navy-400 cursor-not-allowed" : "bg-white text-navy-800 cursor-grab active:cursor-grabbing hover:border-accent-300"
      }`}
    >
      <span className="mt-0.5 font-mono text-xs text-navy-400">{template.code}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{template.name_en}</p>
        <p className="truncate text-xs text-navy-500">{template.name_th}</p>
        <p className="text-xs text-navy-400">{template.item_count} items</p>
      </div>
    </li>
  );
}

// ─────────── Attached list (droppable + sortable) ───────────

function AttachedList({ modules, onDetach }: { modules: ProjectModule[]; onDetach: (pmId: string) => void }) {
  const t = useTranslations("admin.projects");
  const { setNodeRef, isOver } = useDroppable({ id: "attached-drop-zone" });
  return (
    <section
      ref={setNodeRef}
      data-testid="attached-panel"
      className={`card min-h-[240px] transition-colors ${isOver ? "bg-accent-50 ring-2 ring-accent-300" : ""}`}
    >
      <h2 className="mb-3 font-medium text-navy-900">{t("board.attached")}</h2>
      {modules.length === 0 ? (
        <p className="rounded-lg border-2 border-dashed border-navy-200 p-8 text-center text-sm text-navy-500">
          {t("board.emptyHint")}
        </p>
      ) : (
        <SortableContext items={modules.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {modules.map((m) => (
              <AttachedCard key={m.id} module={m} onDetach={onDetach} />
            ))}
          </ul>
        </SortableContext>
      )}
    </section>
  );
}

function AttachedCard({ module: m, onDetach }: { module: ProjectModule; onDetach: (pmId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: m.id,
    data: { kind: "attached" satisfies DragKind },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const done = m.items.filter((it) => it.status !== "pending").length;
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`attached-card-${m.code}`}
      className="flex items-start gap-2 rounded-lg border border-navy-100 bg-white p-3"
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="drag handle"
        className="mt-1 cursor-grab text-navy-300 hover:text-navy-500 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-navy-400">{m.code}</span>
          <p className="font-medium text-navy-900">{m.name_en}</p>
        </div>
        <p className="text-xs text-navy-500">{m.name_th}</p>
        <p className="mt-1 text-xs text-navy-400">
          {done} / {m.items.length}
        </p>
      </div>
      <button
        onClick={() => onDetach(m.id)}
        aria-label="detach module"
        className="rounded p-1 text-navy-400 hover:bg-red-50 hover:text-red-600"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

function VisibilityToggle({ project, onChange }: { project: Project; onChange: (v: boolean) => void }) {
  const t = useTranslations("admin.projects");
  const [saving, setSaving] = useState(false);
  const toggle = async () => {
    const next = !project.visible_to_customer;
    setSaving(true);
    onChange(next);
    try {
      await checklistApi.updateProject(project.id, { visible_to_customer: next });
    } catch {
      onChange(!next);
    } finally {
      setSaving(false);
    }
  };
  return (
    <button
      onClick={toggle}
      disabled={saving || !project.customer_id}
      title={!project.customer_id ? t("board.linkCustomerFirst") : ""}
      className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        !project.customer_id
          ? "bg-navy-100 text-navy-400 cursor-not-allowed"
          : project.visible_to_customer
            ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            : "bg-amber-50 text-amber-800 hover:bg-amber-100"
      }`}
    >
      {project.visible_to_customer ? t("board.visibleToCustomer") : t("board.hiddenFromCustomer")}
    </button>
  );
}

function DragPreview({ kind, id, board, templates }: { kind: DragKind; id: string; board: BoardData; templates: Template[] }) {
  if (kind === "library") {
    const t = templates.find((x) => x.id === id);
    if (!t) return null;
    return (
      <div className="rounded-lg border border-accent-300 bg-white p-2 text-sm shadow-lg">
        <p className="font-medium text-navy-900">{t.code} — {t.name_en}</p>
        <p className="text-xs text-navy-500">{t.name_th}</p>
      </div>
    );
  }
  const m = board.modules.find((x) => x.id === id);
  if (!m) return null;
  return (
    <div className="rounded-lg border border-accent-300 bg-white p-3 text-sm shadow-lg">
      <p className="font-medium text-navy-900">{m.code} — {m.name_en}</p>
    </div>
  );
}
