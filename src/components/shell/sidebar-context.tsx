"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
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
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    let state: SidebarState = "expanded";

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "collapsed" || raw === "expanded") state = raw;
    } catch {
      // private mode / blocked storage
    }

    document.documentElement.dataset.sidebarState = state;
    setCollapsed(state === "collapsed");
  }, []);

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
