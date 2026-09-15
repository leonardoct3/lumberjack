"use client";

import { SidebarProvider } from "./sidebar-context";

/** Client boundary so AppNav + ShellFrame share collapse state. */
export function ShellChrome({ children }: { children: React.ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>;
}
