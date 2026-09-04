"use client";

import { usePathname } from "next/navigation";

export function HideOnLogin({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return children;
}
