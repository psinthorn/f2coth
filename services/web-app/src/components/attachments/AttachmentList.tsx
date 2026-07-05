"use client";

// AttachmentList — gallery + document list for an owner's attachments.
//
// Files are served behind auth, so images can't use a plain <img src>;
// each is fetched as a blob and shown via an object URL (revoked on
// unmount/reload to avoid leaks). Live photos additionally render their
// captured coordinates with a keyless Google Maps link.
//
// Pass a changing `refreshKey` (e.g. an upload counter) to force a reload
// after new uploads.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, MapPin, Trash2, Download, Loader2 } from "lucide-react";
import {
  type Attachment,
  type AttachmentsClient,
  isImageKind,
  mapsLink,
} from "@/lib/attachments-api";

interface Props {
  ownerType: string;
  ownerId: string;
  client: AttachmentsClient;
  canDelete?: boolean;
  refreshKey?: number | string;
}

export default function AttachmentList({ ownerType, ownerId, client, canDelete, refreshKey }: Props) {
  const t = useTranslations("attachments");
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const urlsRef = useRef<string[]>([]);

  const revokeAll = useCallback(() => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .list(ownerType, ownerId)
      .then(async (list) => {
        if (cancelled) return;
        setItems(list);
        // Fetch object URLs for images only.
        const map: Record<string, string> = {};
        await Promise.all(
          list.filter(isImageKind).map(async (a) => {
            try {
              const url = await client.blobUrl(a.id);
              urlsRef.current.push(url);
              map[a.id] = url;
            } catch {
              /* leave thumbnail blank on error */
            }
          }),
        );
        if (!cancelled) setThumbs(map);
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      revokeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerType, ownerId, refreshKey]);

  async function download(a: Attachment) {
    try {
      const url = await client.blobUrl(a.id);
      const el = document.createElement("a");
      el.href = url;
      el.download = a.filename;
      document.body.appendChild(el);
      el.click();
      el.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  async function remove(a: Attachment) {
    await client.remove(a.id).catch(() => {});
    setItems((prev) => prev.filter((x) => x.id !== a.id));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-navy-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("loading")}
      </div>
    );
  }
  if (items.length === 0) return null;

  const images = items.filter(isImageKind);
  const docs = items.filter((a) => !isImageKind(a));

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {images.map((a) => (
            <figure key={a.id} className="group relative overflow-hidden rounded-lg border border-navy-100 bg-navy-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumbs[a.id] ? (
                <img src={thumbs[a.id]} alt={a.filename} className="h-32 w-full object-cover" />
              ) : (
                <div className="flex h-32 w-full items-center justify-center text-navy-300">
                  <FileText className="h-6 w-6" />
                </div>
              )}
              {(a.latitude != null && a.longitude != null) && (
                <a
                  href={mapsLink(a.latitude, a.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80"
                  title={`${a.latitude.toFixed(5)}, ${a.longitude.toFixed(5)}`}
                >
                  <MapPin className="h-3 w-3" /> {t("viewOnMap")}
                </a>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => remove(a)}
                  className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600"
                  aria-label={t("remove")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </figure>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <ul className="space-y-1">
          {docs.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-navy-400" />
              <button type="button" onClick={() => download(a)} className="flex-1 truncate text-left text-navy-700 hover:text-accent-700">
                {a.filename}
              </button>
              <span className="text-xs text-navy-400">{(a.size_bytes / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => download(a)} className="text-navy-400 hover:text-accent-700" aria-label={t("download")}>
                <Download className="h-3.5 w-3.5" />
              </button>
              {canDelete && (
                <button type="button" onClick={() => remove(a)} className="text-navy-400 hover:text-red-600" aria-label={t("remove")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
