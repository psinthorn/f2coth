// Factory for the per-section gate layout.
//
// Usage in app/[locale]/<section>/layout.tsx:
//
//   import { createGateLayout } from "@/lib/moduleGateLayout";
//   export default createGateLayout("public.blog");
//
// Keeps every section's layout to a single line so we don't paste the same
// 4-line guard 18 times. Returns a server component that renders its children
// when the module is enabled and triggers notFound() otherwise.

import { notFound } from "next/navigation";
import { isModuleEnabled, type ModuleKey } from "./modules";

export function createGateLayout(moduleKey: ModuleKey) {
  return async function ModuleGateLayout({
    children,
  }: {
    children: React.ReactNode;
  }) {
    if (!(await isModuleEnabled(moduleKey))) {
      notFound();
    }
    return <>{children}</>;
  };
}
