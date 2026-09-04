"use client";

import { usePathname } from "next/navigation";

export function ShellFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return (
    <div className="md:pl-56">
      <div className="mx-auto max-w-[1100px] px-4 pt-4 pb-24 md:pb-8">
        {children}
      </div>
    </div>
  );
}
