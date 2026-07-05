"use client";

// AttachmentUploader — reusable upload control for tickets and projects.
// Three ways in: attach documents, attach images, or take a live photo
// with the device camera (which also captures GPS coordinates via the
// browser Geolocation API and stamps them on the upload).
//
// Multi-file is done client-side: each selected file is POSTed on its own
// (the server is one-file-per-request), so this works uniformly across
// every surface. Bind it to an owner by passing ownerType + ownerId and
// one of the pre-wired clients from lib/attachments-api.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, Image as ImageIcon, Camera, MapPin, Loader2, AlertTriangle } from "lucide-react";
import {
  type Attachment,
  type AttachmentKind,
  type AttachmentsClient,
  type GeoTag,
} from "@/lib/attachments-api";

const MAX_BYTES = 10 * 1024 * 1024; // keep in sync with backend cap.

const DOC_ACCEPT =
  "image/*,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "text/plain,text/csv";

interface Props {
  ownerType: string;
  ownerId: string;
  client: AttachmentsClient;
  onUploaded?: (a: Attachment) => void;
  /** Tighter layout for reply composers and checklist items. */
  compact?: boolean;
}

interface Row {
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

// getGeo resolves the current position, or undefined if geolocation is
// unavailable/denied — in which case a live photo still uploads, minus
// coordinates (graceful degradation).
function getGeo(): Promise<GeoTag | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(undefined);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date(pos.timestamp).toISOString(),
        }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export default function AttachmentUploader({ ownerType, ownerId, client, onUploaded, compact }: Props) {
  const t = useTranslations("attachments");
  const docRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [locating, setLocating] = useState(false);

  function setRow(name: string, patch: Partial<Row>) {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.name === name && r.status === "uploading");
      if (i === -1) return [...prev, { name, status: "uploading", ...patch } as Row];
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  async function uploadOne(file: File, kind: AttachmentKind, geo?: GeoTag) {
    const label = file.name;
    setRows((prev) => [...prev, { name: label, status: "uploading" }]);
    if (file.size > MAX_BYTES) {
      setRow(label, { status: "error", error: t("fileTooLarge", { max: "10 MB" }) });
      return;
    }
    try {
      const a = await client.upload(ownerType, ownerId, kind, file, geo);
      setRow(label, { status: "done" });
      onUploaded?.(a);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("uploadFailed");
      setRow(label, { status: "error", error: msg });
    }
  }

  async function onPick(kind: AttachmentKind, files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      await uploadOne(f, kind);
    }
  }

  async function onCapture(files: FileList | null) {
    if (!files || files.length === 0) return;
    setLocating(true);
    const geo = await getGeo();
    setLocating(false);
    for (const f of Array.from(files)) {
      await uploadOne(f, "live_photo", geo);
    }
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 " +
    "text-xs font-medium text-navy-700 hover:border-accent-400 hover:text-accent-700 " +
    "cursor-pointer transition-colors";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => docRef.current?.click()}>
          <Paperclip className="h-3.5 w-3.5" /> {t("attachDocuments")}
        </button>
        <button type="button" className={btn} onClick={() => imgRef.current?.click()}>
          <ImageIcon className="h-3.5 w-3.5" /> {t("attachImages")}
        </button>
        <button type="button" className={btn} onClick={() => camRef.current?.click()}>
          <Camera className="h-3.5 w-3.5" /> {t("takePhoto")}
        </button>
        {locating && (
          <span className="inline-flex items-center gap-1 text-xs text-navy-500">
            <MapPin className="h-3.5 w-3.5 animate-pulse" /> {t("capturingLocation")}
          </span>
        )}
      </div>

      <input
        ref={docRef}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        className="hidden"
        onChange={(e) => { onPick("document", e.target.files); e.target.value = ""; }}
      />
      <input
        ref={imgRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => { onPick("image", e.target.files); e.target.value = ""; }}
      />
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { onCapture(e.target.files); e.target.value = ""; }}
      />

      {rows.length > 0 && (
        <ul className="space-y-1 text-xs">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center gap-1.5">
              {r.status === "uploading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-navy-400" />}
              {r.status === "done" && <span className="h-1.5 w-1.5 rounded-full bg-green-500" />}
              {r.status === "error" && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
              <span className="truncate text-navy-600">{r.name}</span>
              {r.status === "uploading" && <span className="text-navy-400">{t("uploading")}</span>}
              {r.status === "error" && <span className="text-red-600">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
