import {
  Bot, Building2, Chrome, Cloud, GitBranch, Globe, Headset, LayoutDashboard,
  Mail, Network, Palette, Server, ShieldCheck, Sparkles, Sun, Wrench,
  type LucideIcon,
} from "lucide-react";

const map: Record<string, LucideIcon> = {
  Bot, Building2, Chrome, Cloud, GitBranch, Globe, Headset, LayoutDashboard,
  Mail, Network, Palette, Server, ShieldCheck, Sparkles, Sun, Wrench,
};

export function ServiceIcon({
  name,
  className = "h-6 w-6",
}: { name?: string | null; className?: string }) {
  const Comp: LucideIcon = (name ? map[name] : undefined) ?? Wrench;
  return <Comp className={className} aria-hidden />;
}
