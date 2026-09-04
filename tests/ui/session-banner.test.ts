import { describe, expect, it } from "vitest";
import { sessionBanner } from "@/components/ui/session-banner";

describe("sessionBanner", () => {
  it("hides the bar when connected", () => {
    expect(sessionBanner("connected")).toBeNull();
  });

  it("uses lime copy for QR", () => {
    expect(sessionBanner("qr")).toEqual({ tone: "accent", text: "QR pendente" });
  });

  it("uses danger copy when disconnected", () => {
    expect(sessionBanner("disconnected")).toEqual({
      tone: "danger",
      text: "WhatsApp desconectado",
    });
  });
});
