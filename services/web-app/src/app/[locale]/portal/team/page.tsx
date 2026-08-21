"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, UserPlus, Trash2, Ban, RotateCcw, ShieldAlert } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { toast, useBusyAction } from "@/lib/toast";
import { portalApi, type PortalMember, type OrgRole } from "@/lib/portal-api";

const ALL_ROLES: OrgRole[] = ["owner", "admin", "billing", "member", "viewer"];

export default function PortalTeamPage() {
  return (
    <PortalShell>
      <TeamView />
    </PortalShell>
  );
}

function TeamView() {
  const t = useTranslations("portal.team");
  const tc = useTranslations("common");
  const [members, setMembers] = useState<PortalMember[] | null>(null);
  const [myRole, setMyRole] = useState<OrgRole>("member");
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [me, list] = await Promise.all([portalApi.me(), portalApi.listMembers()]);
    setMyRole(me.contact.role);
    setMyId(me.contact.id);
    setMembers(list.members);
  }, []);

  useEffect(() => { reload().catch(() => {}).finally(() => setLoading(false)); }, [reload]);

  // Roles the current user is allowed to grant (admins can't grant owner).
  const grantable = myRole === "owner" ? ALL_ROLES : ALL_ROLES.filter((r) => r !== "owner");
  // Can the current user act on a given member row?
  const canManage = (m: PortalMember) => myRole === "owner" || (myRole === "admin" && m.role !== "owner");

  if (loading) {
    return <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-5 w-5 animate-spin" /> {tc("loading")}</div>;
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <InviteForm grantable={grantable} onInvited={reload} />

      <div className="mt-6 overflow-hidden rounded-xl border border-navy-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <th className="px-4 py-2.5 font-medium">{t("col.member")}</th>
              <th className="px-4 py-2.5 font-medium">{t("col.role")}</th>
              <th className="px-4 py-2.5 font-medium">{t("col.status")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("col.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {members?.map((m) => (
              <MemberRow
                key={m.contact_id}
                member={m}
                grantable={grantable}
                canManage={canManage(m)}
                isSelf={m.contact_id === myId}
                onChanged={reload}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InviteForm({ grantable, onInvited }: { grantable: OrgRole[]; onInvited: () => Promise<void> }) {
  const t = useTranslations("portal.team");
  const tc = useTranslations("common");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const { busy, run } = useBusyAction();

  const submit = async () => {
    if (!email.trim() || !name.trim()) { toast.error(t("invite.required")); return; }
    const ok = await run(
      async () => { await portalApi.inviteMember({ email: email.trim(), full_name: name.trim(), role }); await onInvited(); },
      { success: t("invite.sent") },
    );
    if (ok) { setEmail(""); setName(""); setRole("member"); }
  };

  return (
    <div className="rounded-xl border border-navy-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-navy-800">
        <UserPlus className="h-4 w-4 text-accent-600" />
        <h2 className="font-medium">{t("invite.title")}</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("invite.namePlaceholder")}
          className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={t("invite.emailPlaceholder")}
          className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none" />
        <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)}
          className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none">
          {grantable.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </select>
        <button onClick={submit} disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t("invite.send")}
        </button>
      </div>
      <p className="mt-2 text-xs text-navy-400">{t("invite.hint")}</p>
    </div>
  );
}

function MemberRow({ member: m, grantable, canManage, isSelf, onChanged }: {
  member: PortalMember; grantable: OrgRole[]; canManage: boolean; isSelf: boolean; onChanged: () => Promise<void>;
}) {
  const t = useTranslations("portal.team");
  const tc = useTranslations("common");
  const { busy, run } = useBusyAction();

  const changeRole = async (role: OrgRole) => {
    if (role === m.role) return;
    await run(async () => { await portalApi.setMemberRole(m.contact_id, role); await onChanged(); }, { success: t("toast.roleChanged") });
  };
  const toggleStatus = async () => {
    await run(async () => { await portalApi.setMemberStatus(m.contact_id, !m.disabled); await onChanged(); },
      { success: m.disabled ? t("toast.enabled") : t("toast.disabled") });
  };
  const remove = async () => {
    if (!window.confirm(t("remove.confirm", { name: m.full_name }))) return;
    await run(async () => { await portalApi.removeMember(m.contact_id); await onChanged(); }, { success: t("toast.removed") });
  };

  // Options this row may be set to: always include the current role so it shows.
  const options = Array.from(new Set([m.role, ...grantable]));

  return (
    <tr className={m.disabled ? "opacity-60" : ""}>
      <td className="px-4 py-3">
        <div className="font-medium text-navy-900">{m.full_name}{isSelf && <span className="ml-1.5 text-xs text-navy-400">({t("you")})</span>}</div>
        <div className="text-xs text-navy-500">{m.email}</div>
      </td>
      <td className="px-4 py-3">
        {canManage ? (
          <select value={m.role} disabled={busy} onChange={(e) => changeRole(e.target.value as OrgRole)}
            className="rounded-lg border border-navy-200 px-2 py-1 text-sm focus:border-accent-500 focus:outline-none disabled:opacity-50">
            {options.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </select>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-700">
            {m.role === "owner" && <ShieldAlert className="h-3 w-3 text-accent-600" />}{t(`role.${m.role}`)}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {m.disabled && <Badge tone="red">{t("status.disabled")}</Badge>}
          {!m.disabled && m.pending && <Badge tone="amber">{t("status.pending")}</Badge>}
          {!m.disabled && !m.pending && !m.verified && <Badge tone="amber">{t("status.unverified")}</Badge>}
          {!m.disabled && !m.pending && m.verified && <Badge tone="green">{t("status.active")}</Badge>}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1">
          {canManage && (
            <>
              <button onClick={toggleStatus} disabled={busy} title={m.disabled ? t("action.enable") : t("action.disable")}
                className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-50 hover:text-navy-700 disabled:opacity-40">
                {m.disabled ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              </button>
              <button onClick={remove} disabled={busy} title={t("action.remove")}
                className="rounded-lg p-1.5 text-navy-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-navy-400" />}
        </div>
      </td>
    </tr>
  );
}

function Badge({ tone, children }: { tone: "red" | "amber" | "green"; children: React.ReactNode }) {
  const cls = tone === "red" ? "bg-red-50 text-red-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
