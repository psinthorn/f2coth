"use client";

import { use } from "react";
import AdminShell from "@/components/AdminShell";
import ProjectBoard from "@/components/admin/projects/ProjectBoard";

export default function AdminProjectBoardPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id } = use(params);
  return (
    <AdminShell>
      <ProjectBoard projectId={id} />
    </AdminShell>
  );
}
