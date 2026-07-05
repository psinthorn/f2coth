"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import AdminShell from "@/components/AdminShell";
import { Loader2 } from "lucide-react";
import ServiceEditor from "../ServiceEditor";
import { adminApi, type AdminService } from "@/lib/admin-api";

export default function AdminServiceEditPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const tc = useTranslations("common");
  const [service, setService] = useState<AdminService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.getAdminService(slug)
      .then(setService)
      .catch(() => setError(tc("errorLoad")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (loading) {
    return (
      <AdminShell>
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      </AdminShell>
    );
  }
  if (error || !service) {
    return (
      <AdminShell>
        <div className="card text-center text-navy-500">{error || tc("errorLoad")}</div>
      </AdminShell>
    );
  }
  return <ServiceEditor service={service} />;
}
