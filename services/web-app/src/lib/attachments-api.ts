// Client helper for the attachments API — documents, images, and
// geo-tagged live photos on tickets and projects.
//
// The serve endpoint is auth-gated (BYTEA behind a Bearer check), so an
// `<img src="…/attachments/{id}">` CANNOT display a file — the browser
// won't attach the Authorization header. Display therefore goes through
// `blobUrl()` (fetch + URL.createObjectURL), mirroring the invoice-PDF
// download at portal/billing/[id]/page.tsx. Callers MUST revoke the
// returned object URL when done.
//
// One factory, four pre-wired clients — each surface differs only in its
// base path and which sessionStorage token it carries (portal vs staff).

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
  }
}

export type AttachmentKind = "document" | "image" | "live_photo";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  filename: string;
  mime_type: string;
  size_bytes: number;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_m?: number | null;
  captured_at?: string | null;
  created_at: string;
}

export interface GeoTag {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt?: string; // RFC3339
}

export interface AttachmentsClient {
  upload(ownerType: string, ownerId: string, kind: AttachmentKind, file: File, geo?: GeoTag): Promise<Attachment>;
  list(ownerType: string, ownerId: string): Promise<Attachment[]>;
  /** Fetch the file (auth-gated) and return an object URL. Revoke it when done. */
  blobUrl(id: string): Promise<string>;
  remove(id: string): Promise<void>;
}

function makeClient(basePath: string, tokenKey: string): AttachmentsClient {
  const authHeaders = (): Record<string, string> => {
    const t = typeof window !== "undefined" ? sessionStorage.getItem(tokenKey) : null;
    return t ? { Authorization: `Bearer ${t}` } : {};
  };
  const url = (p: string) => `${API_BASE}${basePath}${p}`;

  return {
    async upload(ownerType, ownerId, kind, file, geo) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("owner_type", ownerType);
      fd.append("owner_id", ownerId);
      fd.append("kind", kind);
      if (geo) {
        fd.append("latitude", String(geo.latitude));
        fd.append("longitude", String(geo.longitude));
        if (geo.accuracy != null) fd.append("accuracy", String(geo.accuracy));
        if (geo.capturedAt) fd.append("captured_at", geo.capturedAt);
      }
      const res = await fetch(url("/attachments"), { method: "POST", headers: authHeaders(), body: fd });
      if (!res.ok) throw new HttpError(res.status, await res.text());
      return (await res.json()) as Attachment;
    },

    async list(ownerType, ownerId) {
      const q = `?owner_type=${encodeURIComponent(ownerType)}&owner_id=${encodeURIComponent(ownerId)}`;
      const res = await fetch(url(`/attachments${q}`), { headers: authHeaders() });
      if (!res.ok) throw new HttpError(res.status, await res.text());
      const data = (await res.json()) as { attachments?: Attachment[] };
      return data.attachments ?? [];
    },

    async blobUrl(id) {
      const res = await fetch(url(`/attachments/${id}`), { headers: authHeaders() });
      if (!res.ok) throw new HttpError(res.status, await res.text());
      return URL.createObjectURL(await res.blob());
    },

    async remove(id) {
      const res = await fetch(url(`/attachments/${id}`), { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new HttpError(res.status, await res.text());
    },
  };
}

// Customer portal tickets (customer-api, portal token).
export const portalAttachments = makeClient("/portal", "f2_portal_access_token");
// Staff admin tickets (customer-api, staff token).
export const adminAttachments = makeClient("/customer/admin", "f2_access_token");
// Staff project checklists (checklist-api, staff token).
export const checklistAttachments = makeClient("/checklists", "f2_access_token");
// Customer portal project view (checklist-api, portal token).
export const checklistPortalAttachments = makeClient("/checklists/portal", "f2_portal_access_token");

/** Keyless Google Maps link for a coordinate pair. */
export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function isImageKind(a: Attachment): boolean {
  return a.kind === "image" || a.kind === "live_photo" || a.mime_type.startsWith("image/");
}
