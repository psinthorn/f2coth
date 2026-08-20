"use client";

import React, { use, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, KeyboardSensor,
  closestCorners, useSensor, useSensors, useDroppable,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2, Check, X, MinusCircle, Circle, ChevronLeft, ChevronDown, ChevronRight, Camera, Plus, Pencil, Trash2, FolderPlus, GripVertical } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { toast, useBusyAction } from "@/lib/toast";
import { checklistApi, type ItemStatus, type ProjectBoard, type ProjectItem, type ProjectModule, type ProjectSubsection, type Suggestion } from "@/lib/checklist-api";
import AttachmentUploader from "@/components/attachments/AttachmentUploader";
import AttachmentList from "@/components/attachments/AttachmentList";
import { checklistAttachments } from "@/lib/attachments-api";

const nextStatus: Record<ItemStatus, ItemStatus> = { pending: "pass", pass: "fail", fail: "na", na: "pending" };

export default function AdminProjectChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AdminShell>
      <ChecklistView projectId={id} />
    </AdminShell>
  );
}

const ProjectIdContext = React.createContext<string>("");
const ReloadContext = React.createContext<() => Promise<void>>(async () => {});

// Container id helpers — items live either directly under a section
// ("sec:<moduleId>") or under a sub-section ("sub:<subId>").
const secContainer = (moduleId: string) => `sec:${moduleId}`;
const subContainer = (subId: string) => `sub:${subId}`;

type Target = { moduleId: string; subId: string | null };

function decodeContainer(cid: string, modules: ProjectModule[]): Target | null {
  if (cid.startsWith("sec:")) return { moduleId: cid.slice(4), subId: null };
  if (cid.startsWith("sub:")) {
    const subId = cid.slice(4);
    for (const m of modules) if (m.subsections.some((s) => s.id === subId)) return { moduleId: m.id, subId };
  }
  return null;
}
function containerItems(modules: ProjectModule[], t: Target): ProjectItem[] {
  const m = modules.find((x) => x.id === t.moduleId);
  if (!m) return [];
  return t.subId ? (m.subsections.find((s) => s.id === t.subId)?.items ?? []) : m.items;
}

function ChecklistView({ projectId }: { projectId: string }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDrag, setActiveDrag] = useState<{ type: string; label: string } | null>(null);

  const reload = useCallback(async () => {
    const b = await checklistApi.getBoard(projectId);
    setBoard(b);
  }, [projectId]);

  useEffect(() => { reload().catch(() => {}).finally(() => setLoading(false)); }, [reload]);

  const patch = useCallback((itemId: string, updates: Partial<ProjectItem>) => {
    const mapItems = (items: ProjectItem[]) => items.map((it) => (it.id === itemId ? { ...it, ...updates } : it));
    setBoard((prev) => prev && {
      ...prev,
      modules: prev.modules.map((m) => ({ ...m, items: mapItems(m.items), subsections: m.subsections.map((s) => ({ ...s, items: mapItems(s.items) })) })),
    });
  }, []);

  const sensors = useSensors(
    // 6px activation so taps on status/edit/note aren't read as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as any;
    setActiveDrag(d ? { type: d.type, label: d.label ?? "" } : null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over || !board) return;
    const aData = active.data.current as any;
    const oData = over.data.current as any;
    if (!aData) return;
    const overId = String(over.id);

    // Which section does the drop target belong to?
    const sectionOf = (): string | null => {
      if (oData?.type === "section") return String(over.id);
      if (oData?.type === "subsection") return oData.moduleId;
      if (oData?.type === "item") return decodeContainer(oData.containerId, board.modules)?.moduleId ?? null;
      const dec = decodeContainer(overId, board.modules); // dropped on a container zone
      return dec?.moduleId ?? null;
    };

    if (aData.type === "section") {
      const targetModule = sectionOf();
      if (!targetModule || targetModule === active.id) return;
      const from = board.modules.findIndex((m) => m.id === active.id);
      const to = board.modules.findIndex((m) => m.id === targetModule);
      if (from < 0 || to < 0) return;
      const next = arrayMove(board.modules, from, to);
      setBoard({ ...board, modules: next });
      checklistApi.reorderModules(projectId, next.map((m) => m.id)).catch(() => { reload(); toast.error(tc("toast.error")); });
      return;
    }

    if (aData.type === "subsection") {
      const targetModule = sectionOf();
      if (targetModule !== aData.moduleId) return; // v1: sub-sections stay in their section
      const mod = board.modules.find((m) => m.id === aData.moduleId);
      if (!mod) return;
      const from = mod.subsections.findIndex((s) => s.id === active.id);
      const to = oData?.type === "subsection"
        ? mod.subsections.findIndex((s) => s.id === over.id)
        : mod.subsections.length - 1;
      if (from < 0 || to < 0 || from === to) return;
      const nextSubs = arrayMove(mod.subsections, from, to);
      setBoard({ ...board, modules: board.modules.map((m) => (m.id === mod.id ? { ...m, subsections: nextSubs } : m)) });
      checklistApi.reorderSubsections(projectId, mod.id, nextSubs.map((s) => s.id)).catch(() => { reload(); toast.error(tc("toast.error")); });
      return;
    }

    if (aData.type === "item") {
      // Resolve destination container.
      let target: Target | null = null;
      let overItemId: string | null = null;
      if (oData?.type === "item") { target = decodeContainer(oData.containerId, board.modules); overItemId = String(over.id); }
      else if (oData?.type === "subsection") target = { moduleId: oData.moduleId, subId: String(over.id) };
      else if (oData?.type === "section") target = { moduleId: String(over.id), subId: null };
      else target = decodeContainer(overId, board.modules);
      if (!target) return;

      const targetContainerId = target.subId ? subContainer(target.subId) : secContainer(target.moduleId);

      // Same container → arrayMove (handles up/down direction correctly; a
      // strip+insert at the over index would no-op when dragging downward).
      if (aData.containerId === targetContainerId) {
        const list = containerItems(board.modules, target);
        const oldIndex = list.findIndex((it) => it.id === active.id);
        const newIndex = overItemId ? list.findIndex((it) => it.id === overItemId) : list.length - 1;
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
        const movedList = arrayMove(list, oldIndex, newIndex);
        const nextModules = board.modules.map((m) => {
          if (m.id !== target!.moduleId) return m;
          if (!target!.subId) return { ...m, items: movedList };
          return { ...m, subsections: m.subsections.map((s) => (s.id === target!.subId ? { ...s, items: movedList } : s)) };
        });
        setBoard({ ...board, modules: nextModules });
        checklistApi.reorderItems(projectId, { module_id: target.moduleId, subsection_id: target.subId, order: movedList.map((i) => i.id) })
          .catch(() => { reload(); toast.error(tc("toast.error")); });
        return;
      }

      // Cross-container: pull the item out, drop it into the target at overItem's slot.
      let moved: ProjectItem | null = null;
      const stripped = board.modules.map((m) => ({
        ...m,
        items: m.items.filter((it) => (it.id === active.id ? ((moved = it), false) : true)),
        subsections: m.subsections.map((s) => ({ ...s, items: s.items.filter((it) => (it.id === active.id ? ((moved = it), false) : true)) })),
      }));
      if (!moved) return;
      const movedItem: ProjectItem = { ...(moved as ProjectItem), project_module_id: target.moduleId, subsection_id: target.subId };

      const dest = containerItems(stripped, target);
      let idx = dest.length;
      if (overItemId) { const i = dest.findIndex((it) => it.id === overItemId); if (i >= 0) idx = i; }

      const nextModules = stripped.map((m) => {
        if (m.id !== target!.moduleId) return m;
        if (!target!.subId) { const items = [...m.items]; items.splice(idx, 0, movedItem); return { ...m, items }; }
        return { ...m, subsections: m.subsections.map((s) => { if (s.id !== target!.subId) return s; const items = [...s.items]; items.splice(idx, 0, movedItem); return { ...s, items }; }) };
      });
      setBoard({ ...board, modules: nextModules });
      const orderIds = containerItems(nextModules, target).map((it) => it.id);
      checklistApi.reorderItems(projectId, { module_id: target.moduleId, subsection_id: target.subId, order: orderIds })
        .catch(() => { reload(); toast.error(tc("toast.error")); });
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>;
  if (!board) return <div className="card text-center text-navy-500">{t("board.notFound")}</div>;

  return (
    <div>
      <header className="mb-6">
        <Link href={`/admin/projects/${projectId}` as any} className="mb-2 inline-flex items-center gap-1 text-sm text-navy-600 hover:text-navy-900">
          <ChevronLeft className="h-4 w-4" /> {t("board.backToBoard")}
        </Link>
        <h1 className="font-display text-3xl text-navy-900">{board.project.name}</h1>
        <p className="text-sm text-navy-600">{t("checklist.subtitle")} · {t("checklist.dragHint")}</p>
      </header>
      <ProjectIdContext.Provider value={projectId}>
        <ReloadContext.Provider value={reload}>
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <SortableContext items={board.modules.map((m) => m.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {board.modules.map((m) => <SortableSection key={m.id} module={m} onPatch={patch} />)}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDrag ? <div className="rounded-lg border border-accent-300 bg-white px-3 py-2 text-sm shadow-lg">{activeDrag.label}</div> : null}
            </DragOverlay>
          </DndContext>
          <AddSectionRow existing={new Set(board.modules.flatMap((m) => [norm(m.name_en), norm(m.name_th)]))} />
        </ReloadContext.Provider>
      </ProjectIdContext.Provider>
    </div>
  );
}

function DragHandle({ listeners, attributes }: { listeners: any; attributes: any }) {
  return (
    <button {...listeners} {...attributes} aria-label="drag handle" className="cursor-grab touch-none text-navy-300 hover:text-navy-500 active:cursor-grabbing">
      <GripVertical className="h-4 w-4" />
    </button>
  );
}

// ─────────── Section ───────────

function SortableSection({ module: m, onPatch }: { module: ProjectModule; onPatch: (id: string, u: Partial<ProjectItem>) => void }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const projectId = useContext(ProjectIdContext);
  const reload = useContext(ReloadContext);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id, data: { type: "section", label: m.name_en } });
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const { busy, run } = useBusyAction();

  const total = m.items.length + m.subsections.reduce((n, s) => n + s.items.length, 0);
  const done = m.items.filter((it) => it.status !== "pending").length + m.subsections.reduce((n, s) => n + s.items.filter((it) => it.status !== "pending").length, 0);

  const rename = async (name_en: string, name_th: string) => {
    const ok = await run(async () => { await checklistApi.updateSection(projectId, m.id, { name_en, name_th }); await reload(); }, { success: tc("toast.saved") });
    if (ok) setEditing(false);
  };
  const remove = async () => {
    if (!window.confirm(t("checklist.section.deleteConfirm"))) return;
    await run(async () => { await checklistApi.detachModule(projectId, m.id); await reload(); }, { success: tc("toast.deleted") });
  };

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <section ref={setNodeRef} style={style} className="card p-0 overflow-hidden">
      <div className="flex w-full items-center gap-2 px-4 py-3 hover:bg-navy-50">
        <DragHandle listeners={listeners} attributes={attributes} />
        <button onClick={() => setExpanded((x) => !x)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-navy-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-navy-500" />}
          {m.code && <span className="font-mono text-xs text-navy-400">{m.code}</span>}
          {!editing && (
            <div className="min-w-0 flex-1">
              <p className="font-medium text-navy-900">{m.name_en}{m.is_custom && <CustomBadge />}</p>
              <p className="text-xs text-navy-500">{m.name_th}</p>
            </div>
          )}
        </button>
        {!editing && (
          <>
            <span className="text-xs text-navy-500">{done} / {total}</span>
            <button onClick={() => setEditing(true)} disabled={busy} aria-label={tc("edit")} className="rounded p-1 text-navy-400 hover:bg-navy-100 hover:text-navy-700 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={remove} disabled={busy} aria-label={tc("delete")} className="rounded p-1 text-navy-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
      {editing && <div className="px-4 pb-3"><NameEditor initialEn={m.name_en} initialTh={m.name_th} busy={busy} onSave={rename} onCancel={() => setEditing(false)} /></div>}
      {expanded && (
        <div className="border-t border-navy-100">
          <SortableContext items={m.subsections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {m.subsections.map((s) => <SortableSubsection key={s.id} subsection={s} moduleId={m.id} onPatch={onPatch} />)}
          </SortableContext>
          <ItemContainer containerId={secContainer(m.id)} items={m.items} onPatch={onPatch} />
          <div className="flex flex-wrap gap-4 px-3 py-2">
            <AddItemRow moduleId={m.id} subsectionId={null} existing={new Set(m.items.flatMap((it) => [norm(it.text_en), norm(it.text_th)]))} />
            <AddSubsectionButton moduleId={m.id} existing={new Set(m.subsections.flatMap((s) => [norm(s.name_en), norm(s.name_th)]))} />
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────── Sub-section ───────────

function SortableSubsection({ subsection: s, moduleId, onPatch }: { subsection: ProjectSubsection; moduleId: string; onPatch: (id: string, u: Partial<ProjectItem>) => void }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const reload = useContext(ReloadContext);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, data: { type: "subsection", moduleId, label: s.name_en } });
  const [editing, setEditing] = useState(false);
  const { busy, run } = useBusyAction();

  const rename = async (name_en: string, name_th: string) => {
    const ok = await run(async () => { await checklistApi.updateSubsection(s.id, { name_en, name_th }); await reload(); }, { success: tc("toast.saved") });
    if (ok) setEditing(false);
  };
  const remove = async () => {
    if (!window.confirm(t("checklist.subsection.deleteConfirm"))) return;
    await run(async () => { await checklistApi.deleteSubsection(s.id); await reload(); }, { success: tc("toast.deleted") });
  };

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="border-t border-navy-100 bg-navy-50/30">
      <div className="flex items-center gap-2 px-4 py-2">
        <DragHandle listeners={listeners} attributes={attributes} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">{t("checklist.subsection.label")}</span>
        {editing ? (
          <div className="flex-1"><NameEditor initialEn={s.name_en} initialTh={s.name_th} busy={busy} onSave={rename} onCancel={() => setEditing(false)} /></div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-navy-800">{s.name_en}</p>
              <p className="text-xs text-navy-500">{s.name_th}</p>
            </div>
            <span className="text-xs text-navy-400">{s.items.filter((it) => it.status !== "pending").length} / {s.items.length}</span>
            <button onClick={() => setEditing(true)} disabled={busy} aria-label={tc("edit")} className="rounded p-1 text-navy-400 hover:bg-navy-100 hover:text-navy-700 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={remove} disabled={busy} aria-label={tc("delete")} className="rounded p-1 text-navy-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
      <div className="pl-4">
        <ItemContainer containerId={subContainer(s.id)} items={s.items} onPatch={onPatch} />
      </div>
      <div className="px-3 py-2 pl-4"><AddItemRow moduleId={moduleId} subsectionId={s.id} existing={new Set(s.items.flatMap((it) => [norm(it.text_en), norm(it.text_th)]))} /></div>
    </div>
  );
}

// A droppable, sortable list of items. Empty containers still accept drops via
// a placeholder drop zone so items can be moved into an empty sub-section.
function ItemContainer({ containerId, items, onPatch }: { containerId: string; items: ProjectItem[]; onPatch: (id: string, u: Partial<ProjectItem>) => void }) {
  const t = useTranslations("admin.projects");
  const { setNodeRef, isOver } = useDroppable({ id: containerId, data: { containerId } });
  return (
    <SortableContext items={items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
      {items.length > 0 ? (
        <ul className="divide-y divide-navy-100">
          {items.map((it) => <SortableItem key={it.id} item={it} containerId={containerId} onPatch={onPatch} />)}
        </ul>
      ) : (
        <div ref={setNodeRef} className={`mx-3 my-1 rounded-lg border border-dashed px-3 py-2 text-center text-xs ${isOver ? "border-accent-400 bg-accent-50 text-accent-700" : "border-navy-200 text-navy-400"}`}>
          {t("checklist.dropHere")}
        </div>
      )}
    </SortableContext>
  );
}

function SortableItem({ item, containerId, onPatch }: { item: ProjectItem; containerId: string; onPatch: (id: string, u: Partial<ProjectItem>) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, data: { type: "item", containerId, label: item.text_en } });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return <ItemRow item={item} onPatch={onPatch} dragRef={setNodeRef} dragStyle={style} handle={<DragHandle listeners={listeners} attributes={attributes} />} />;
}

// ─────────── Inline name editor ───────────

function NameEditor({ initialEn, initialTh, busy, onSave, onCancel }: { initialEn: string; initialTh: string; busy: boolean; onSave: (en: string, th: string) => void; onCancel: () => void }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const [en, setEn] = useState(initialEn);
  const [th, setTh] = useState(initialTh);
  return (
    <div className="space-y-1.5 py-1">
      <input autoFocus value={en} onChange={(e) => setEn(e.target.value)} placeholder={t("checklist.nameEnPlaceholder")} className="w-full rounded-lg border border-navy-200 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none" />
      <input value={th} onChange={(e) => setTh(e.target.value)} placeholder={t("checklist.nameThPlaceholder")} className="w-full rounded-lg border border-navy-200 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none" />
      <div className="flex gap-2">
        <button onClick={() => { if (!en.trim() || !th.trim()) { toast.error(t("checklist.addItem.bothRequired")); return; } onSave(en.trim(), th.trim()); }} disabled={busy} className="rounded-lg bg-accent-500 px-2.5 py-1 text-xs text-white hover:bg-accent-600 disabled:opacity-50">{tc("save")}</button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-navy-200 px-2.5 py-1 text-xs hover:bg-navy-50 disabled:opacity-50">{tc("cancel")}</button>
      </div>
    </div>
  );
}

// ─────────── Add rows ───────────

function AddSectionRow({ existing }: { existing: Set<string> }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const projectId = useContext(ProjectIdContext);
  const reload = useContext(ReloadContext);
  const [open, setOpen] = useState(false);
  const [en, setEn] = useState("");
  const [th, setTh] = useState("");
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const { busy, run } = useBusyAction();
  const dup = en.trim() !== "" && (existing.has(norm(en)) || (th.trim() !== "" && existing.has(norm(th))));
  const reset = () => { setEn(""); setTh(""); setSaveToLibrary(false); setOpen(false); };
  const submit = async () => {
    if (!en.trim() || !th.trim()) { toast.error(t("checklist.addItem.bothRequired")); return; }
    if (dup) { toast.error(t("checklist.dupWarning")); return; }
    const ok = await run(async () => { await checklistApi.createSection(projectId, { name_en: en.trim(), name_th: th.trim(), save_to_library: saveToLibrary }); await reload(); }, { success: tc("toast.added") });
    if (ok) reset();
  };
  if (!open) return (
    <div className="mt-3">
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-navy-300 px-3 py-2 text-sm text-navy-600 hover:border-accent-400 hover:text-accent-700"><Plus className="h-4 w-4" /> {t("checklist.section.addButton")}</button>
    </div>
  );
  return (
    <div className="card mt-3 space-y-2">
      <p className="text-sm font-medium text-navy-800">{t("checklist.section.addTitle")}</p>
      <SuggestBox kind="section" en={en} th={th} onChange={(e, h) => { setEn(e); setTh(h); }} existing={existing} enPlaceholder={t("checklist.nameEnPlaceholder")} thPlaceholder={t("checklist.nameThPlaceholder")} dup={dup} autoFocus />
      <label className="flex items-center gap-2 text-xs text-navy-700"><input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} className="rounded border-navy-300" />{t("checklist.section.saveToLibrary")}</label>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || dup} className="inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-sm text-white hover:bg-accent-600 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {tc("add")}</button>
        <button onClick={reset} disabled={busy} className="rounded-lg border border-navy-200 px-3 py-1.5 text-sm hover:bg-navy-50 disabled:opacity-50">{tc("cancel")}</button>
      </div>
    </div>
  );
}

function AddSubsectionButton({ moduleId, existing }: { moduleId: string; existing: Set<string> }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const projectId = useContext(ProjectIdContext);
  const reload = useContext(ReloadContext);
  const [open, setOpen] = useState(false);
  const [en, setEn] = useState("");
  const [th, setTh] = useState("");
  const { busy, run } = useBusyAction();
  const dup = en.trim() !== "" && (existing.has(norm(en)) || (th.trim() !== "" && existing.has(norm(th))));
  const reset = () => { setEn(""); setTh(""); setOpen(false); };
  const submit = async () => {
    if (!en.trim() || !th.trim()) { toast.error(t("checklist.addItem.bothRequired")); return; }
    if (dup) { toast.error(t("checklist.dupWarning")); return; }
    const ok = await run(async () => { await checklistApi.createSubsection(projectId, moduleId, { name_en: en.trim(), name_th: th.trim() }); await reload(); }, { success: tc("toast.added") });
    if (ok) reset();
  };
  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700"><FolderPlus className="h-4 w-4" /> {t("checklist.subsection.addButton")}</button>;
  return (
    <div className="w-full max-w-md space-y-2 rounded-lg border border-navy-200 bg-white p-2">
      <p className="text-xs font-medium text-navy-700">{t("checklist.subsection.addTitle")}</p>
      <SuggestBox kind="subsection" en={en} th={th} onChange={(e, h) => { setEn(e); setTh(h); }} existing={existing} enPlaceholder={t("checklist.nameEnPlaceholder")} thPlaceholder={t("checklist.nameThPlaceholder")} dup={dup} autoFocus />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || dup} className="inline-flex items-center gap-1 rounded-lg bg-accent-500 px-2.5 py-1 text-xs text-white hover:bg-accent-600 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {tc("add")}</button>
        <button onClick={reset} disabled={busy} className="rounded-lg border border-navy-200 px-2.5 py-1 text-xs hover:bg-navy-50 disabled:opacity-50">{tc("cancel")}</button>
      </div>
    </div>
  );
}

function AddItemRow({ moduleId, subsectionId, existing }: { moduleId: string; subsectionId: string | null; existing: Set<string> }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const projectId = useContext(ProjectIdContext);
  const reload = useContext(ReloadContext);
  const [open, setOpen] = useState(false);
  const [textEn, setTextEn] = useState("");
  const [textTh, setTextTh] = useState("");
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const { busy, run } = useBusyAction();
  const dup = textEn.trim() !== "" && (existing.has(norm(textEn)) || (textTh.trim() !== "" && existing.has(norm(textTh))));
  const reset = () => { setTextEn(""); setTextTh(""); setSaveToLibrary(false); setOpen(false); };
  const submit = async () => {
    if (!textEn.trim() || !textTh.trim()) { toast.error(t("checklist.addItem.bothRequired")); return; }
    if (dup) { toast.error(t("checklist.dupWarning")); return; }
    const ok = await run(async () => { await checklistApi.addItem(projectId, moduleId, { text_en: textEn.trim(), text_th: textTh.trim(), save_to_library: saveToLibrary, subsection_id: subsectionId }); await reload(); }, { success: tc("toast.added") });
    if (ok) reset();
  };
  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm text-accent-600 hover:text-accent-700"><Plus className="h-4 w-4" /> {t("checklist.addItem.button")}</button>;
  return (
    <div className="w-full max-w-md space-y-2 rounded-lg border border-navy-200 bg-white p-2">
      <SuggestBox kind="item" en={textEn} th={textTh} onChange={(e, h) => { setTextEn(e); setTextTh(h); }} existing={existing} enPlaceholder={t("checklist.addItem.textEnPlaceholder")} thPlaceholder={t("checklist.addItem.textThPlaceholder")} dup={dup} autoFocus />
      <label className="flex items-center gap-2 text-xs text-navy-700"><input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} className="rounded border-navy-300" />{t("checklist.addItem.saveToLibrary")}</label>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || dup} className="inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-sm text-white hover:bg-accent-600 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {tc("add")}</button>
        <button onClick={reset} disabled={busy} className="rounded-lg border border-navy-200 px-3 py-1.5 text-sm hover:bg-navy-50 disabled:opacity-50">{tc("cancel")}</button>
      </div>
    </div>
  );
}

function CustomBadge() {
  const t = useTranslations("admin.projects");
  return <span className="ml-2 rounded-full bg-accent-50 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-accent-700">{t("checklist.customBadge")}</span>;
}

const norm = (s: string) => s.trim().toLowerCase();

// Controlled EN+TH inputs with a smart-suggestion dropdown (library + existing
// project entries) and an inline duplicate warning. `existing` is the set of
// normalised names already in the target scope; when the typed name is in it
// `dup` is true and the parent disables submit.
function SuggestBox({
  kind, en, th, onChange, existing, enPlaceholder, thPlaceholder, dup, autoFocus,
}: {
  kind: "section" | "subsection" | "item";
  en: string; th: string; onChange: (en: string, th: string) => void;
  existing: Set<string>; enPlaceholder: string; thPlaceholder: string; dup: boolean; autoFocus?: boolean;
}) {
  const t = useTranslations("admin.projects");
  const projectId = useContext(ProjectIdContext);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = en.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try { const r = await checklistApi.suggest(projectId, kind, q); if (!cancelled) { setSuggestions(r.suggestions); setOpen(true); } } catch { /* ignore */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [en, kind, projectId]);

  const inputCls = `w-full rounded-lg border px-2 py-1.5 text-sm focus:outline-none ${dup ? "border-red-300 focus:border-red-500" : "border-navy-200 focus:border-accent-500"}`;
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          autoFocus={autoFocus}
          value={en}
          onChange={(e) => onChange(e.target.value, th)}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={enPlaceholder}
          className={inputCls}
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-navy-200 bg-white shadow-lg">
            {suggestions.map((s, i) => {
              const already = s.exists || existing.has(norm(s.name_en));
              return (
                <li key={`${s.name_en}-${i}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); if (!already) { onChange(s.name_en, s.name_th); setOpen(false); } }}
                    disabled={already}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-navy-50 ${already ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-navy-900">{s.name_en}</span>
                      <span className="ml-2 text-xs text-navy-400">{s.name_th}</span>
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${s.source === "library" ? "bg-accent-50 text-accent-700" : "bg-navy-100 text-navy-500"}`}>
                      {s.source === "library" ? t("checklist.suggest.library") : t("checklist.suggest.inProject")}
                    </span>
                    {already && <span className="shrink-0 text-[10px] text-navy-400">{t("checklist.suggest.added")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <input value={th} onChange={(e) => onChange(en, e.target.value)} placeholder={thPlaceholder} className={inputCls} />
      {dup && <p className="text-xs text-red-600">{t("checklist.dupWarning")}</p>}
    </div>
  );
}

// ─────────── Item row ───────────

function ItemRow({ item, onPatch, dragRef, dragStyle, handle }: { item: ProjectItem; onPatch: (id: string, u: Partial<ProjectItem>) => void; dragRef?: (el: HTMLElement | null) => void; dragStyle?: React.CSSProperties; handle?: React.ReactNode }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const ta = useTranslations("attachments");
  const reload = useContext(ReloadContext);
  const [note, setNote] = useState(item.note ?? "");
  const [uploading, setUploading] = useState(false);
  const [attachTick, setAttachTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editEn, setEditEn] = useState(item.text_en);
  const [editTh, setEditTh] = useState(item.text_th);
  const projectId = useContext(ProjectIdContext);
  const { busy, run } = useBusyAction();

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await checklistApi.uploadPhoto(file, projectId || undefined);
      await checklistApi.updateItem(item.id, { photo_url: url });
      onPatch(item.id, { photo_url: url });
      toast.success(tc("toast.saved"));
    } catch (e) { toast.error(e instanceof Error ? e.message : tc("toast.error")); } finally { setUploading(false); }
  };
  const cycle = async () => {
    const target = nextStatus[item.status];
    const prev = item.status;
    onPatch(item.id, { status: target });
    const ok = await run(() => checklistApi.updateItem(item.id, { status: target }), { success: tc("toast.updated") });
    if (!ok) onPatch(item.id, { status: prev });
  };
  const saveNote = async () => {
    if (note === (item.note ?? "")) return;
    const ok = await run(() => checklistApi.updateItem(item.id, { note }), { success: tc("toast.saved") });
    if (ok) onPatch(item.id, { note }); else setNote(item.note ?? "");
  };
  const saveText = async () => {
    if (!editEn.trim() || !editTh.trim()) { toast.error(t("checklist.addItem.bothRequired")); return; }
    if (editEn.trim() === item.text_en && editTh.trim() === item.text_th) { setEditing(false); return; }
    const ok = await run(() => checklistApi.updateItem(item.id, { text_en: editEn.trim(), text_th: editTh.trim() }), { success: tc("toast.saved") });
    if (ok) { onPatch(item.id, { text_en: editEn.trim(), text_th: editTh.trim() }); setEditing(false); }
  };
  const remove = async () => {
    if (!window.confirm(t("checklist.deleteConfirm"))) return;
    await run(async () => { await checklistApi.deleteItem(item.id); await reload(); }, { success: tc("toast.deleted") });
  };

  return (
    <li ref={dragRef} style={dragStyle} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
      <div className="flex items-center gap-1 pt-0.5">
        {handle}
        <button onClick={cycle} disabled={busy} data-testid={`status-${item.id}`} aria-label={`status: ${item.status}`} className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40 ${statusColor(item.status)}`}>{statusIcon(item.status)}</button>
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1.5">
            <input autoFocus value={editEn} onChange={(e) => setEditEn(e.target.value)} placeholder={t("checklist.addItem.textEnPlaceholder")} className="w-full rounded-lg border border-navy-200 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none" />
            <input value={editTh} onChange={(e) => setEditTh(e.target.value)} placeholder={t("checklist.addItem.textThPlaceholder")} className="w-full rounded-lg border border-navy-200 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none" />
            <div className="flex gap-2">
              <button onClick={saveText} disabled={busy} className="rounded-lg bg-accent-500 px-2.5 py-1 text-xs text-white hover:bg-accent-600 disabled:opacity-50">{tc("save")}</button>
              <button onClick={() => { setEditing(false); setEditEn(item.text_en); setEditTh(item.text_th); }} disabled={busy} className="rounded-lg border border-navy-200 px-2.5 py-1 text-xs hover:bg-navy-50 disabled:opacity-50">{tc("cancel")}</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-navy-900">{item.text_en}{item.is_custom && <CustomBadge />}</p>
              <p className="text-xs text-navy-500">{item.text_th}</p>
            </div>
            {item.is_custom && (
              <div className="flex shrink-0 gap-1">
                <button onClick={() => setEditing(true)} disabled={busy} aria-label={tc("edit")} className="rounded p-1 text-navy-400 hover:bg-navy-50 hover:text-navy-700 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={remove} disabled={busy} aria-label={tc("delete")} className="rounded p-1 text-navy-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </div>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} placeholder={t("checklist.notePlaceholder")} className="mt-2 w-full rounded-lg border border-navy-100 px-2 py-1 text-xs focus:border-accent-500 focus:outline-none" />
        <div className="mt-2 flex items-center gap-3">
          <label className={`inline-flex items-center gap-1 text-xs cursor-pointer ${uploading ? "text-navy-400" : "text-accent-600 hover:text-accent-700"}`}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            {uploading ? t("checklist.uploading") : t("checklist.attachPhoto")}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
          </label>
          {item.photo_url && <a href={item.photo_url} target="_blank" rel="noreferrer" className="text-xs text-accent-600 underline">{t("checklist.viewPhoto")}</a>}
        </div>
        <div className="mt-3 border-t border-navy-100 pt-3">
          <div className="mb-1.5 text-xs font-medium text-navy-600">{ta("title")}</div>
          <AttachmentList ownerType="project_item" ownerId={item.id} client={checklistAttachments} canDelete refreshKey={attachTick} />
          <div className="mt-2"><AttachmentUploader ownerType="project_item" ownerId={item.id} client={checklistAttachments} onUploaded={() => setAttachTick((n) => n + 1)} compact /></div>
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
