"use client";

const SIDEBAR_PREFERENCE_SCRIPT = `(function(){try{var state=localStorage.getItem("lumberjack.sidebar");if(state==="collapsed"||state==="expanded")document.documentElement.dataset.sidebarState=state}catch(error){}})()`;

export function SidebarPreferenceScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SIDEBAR_PREFERENCE_SCRIPT }}
    />
  );
}
