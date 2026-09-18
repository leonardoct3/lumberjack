"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "lumberjack.sidebar";
type SidebarState = "collapsed" | "expanded";

type SidebarContextValue = {
  collapsed: boolean;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "collapsed";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    const next: SidebarState =
      document.documentElement.dataset.sidebarState === "collapsed"
        ? "expanded"
        : "collapsed";

    document.documentElement.dataset.sidebarState = next;
    setCollapsed(next === "collapsed");

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode / blocked storage
    }
  }, []);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        toggle,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return ctx;
}
