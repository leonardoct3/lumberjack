export type BannerTone = "accent" | "muted" | "danger";

export function sessionBanner(
  state: "connected" | "qr" | "disconnected",
): { tone: BannerTone; text: string } | null {
  if (state === "connected") return null;
  if (state === "qr") return { tone: "accent", text: "QR pendente" };
  return { tone: "danger", text: "WhatsApp desconectado" };
}
