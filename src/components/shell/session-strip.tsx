"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CircleAlert, QrCode } from "lucide-react";
import type { SessionGuidance } from "@/components/ui/session-banner";

export function SessionStrip({ banner }: { banner: SessionGuidance | null }) {
  const pathname = usePathname();
  // Setup and pairing states are persistent navigation status, not global outages.
  if (
    !banner ||
    banner.visibility === "setup" ||
    pathname === "/login" ||
    pathname === "/setup"
  ) {
    return null;
  }

  const cls =
    banner.tone === "danger"
      ? "border-destructive/25 bg-destructive/8 text-destructive"
      : "border-primary/25 bg-primary/8 text-primary";
  const Icon = banner.tone === "danger" ? CircleAlert : QrCode;

  return (
    <div
      role="alert"
      className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 ${cls}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{banner.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {banner.step}
        </p>
      </div>
      <Link
        href="/setup"
        className="group mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium no-underline"
      >
        <span className="hidden sm:inline">Setup</span>
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
