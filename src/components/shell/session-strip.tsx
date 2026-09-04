"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CircleAlert, QrCode } from "lucide-react";
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
      ? "border-destructive/25 bg-destructive/8 text-destructive"
      : "border-primary/25 bg-primary/8 text-primary";
  const Icon = banner.tone === "danger" ? CircleAlert : QrCode;
  return (
    <Link
      href="/setup"
      className={`group mb-6 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium no-underline transition-colors hover:bg-card ${cls}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{banner.text}</span>
      <span className="hidden text-xs font-normal opacity-70 sm:inline">
        Revisar conexão
      </span>
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
