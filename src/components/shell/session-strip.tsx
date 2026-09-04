"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sessionBanner } from "@/components/ui/session-banner";

export function SessionStrip({
  state,
}: {
  state: "connected" | "qr" | "disconnected";
}) {
  const pathname = usePathname();
  const banner = sessionBanner(state);
  if (!banner || pathname === "/login") return null;
  const cls =
    banner.tone === "danger"
      ? "border-destructive text-destructive"
      : "border-primary text-primary";
  return (
    <Link
      href="/setup"
      className={`mb-4 block rounded-[10px] border px-3 py-2 text-sm no-underline ${cls}`}
    >
      {banner.text}
    </Link>
  );
}
