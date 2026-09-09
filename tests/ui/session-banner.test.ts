import { describe, expect, it } from "vitest";
import { sessionBanner } from "@/components/ui/session-banner";

describe("sessionBanner", () => {
  it("hides the bar when connected", () => {
    expect(sessionBanner("connected")).toBeNull();
  });

  it("asks for the QR scan in lime when a code is waiting", () => {
    const guidance = sessionBanner("qr");
    expect(guidance?.tone).toBe("accent");
    expect(guidance?.title).toBe("WhatsApp aguardando leitura do QR");
    expect(guidance?.step).toBe(
      "Abra o terminal do connector e escaneie o código em WhatsApp › Aparelhos conectados.",
    );
  });

  it("tells the operator to start the connector when no session was ever written", () => {
    const guidance = sessionBanner("disconnected", "missing-session");
    expect(guidance?.tone).toBe("danger");
    expect(guidance?.title).toBe("Monitor nunca foi ligado");
    expect(guidance?.step).toBe(
      "Rode npm run connector e escaneie o QR que aparece no terminal.",
    );
  });

  it("tells the operator to clear the auth folder when the phone unlinked the session", () => {
    const guidance = sessionBanner("disconnected", "401");
    expect(guidance?.tone).toBe("danger");
    expect(guidance?.title).toBe("Sessão desconectada pelo celular");
    expect(guidance?.step).toBe(
      "Pare o connector, apague data/wa-auth/ e rode npm run connector para gerar um QR novo.",
    );
  });

  it("tells the operator to restart the connector for any other drop", () => {
    const restart = {
      tone: "danger",
      title: "Monitor fora do ar",
      step: "Rode npm run connector para reconectar. As mensagens já salvas continuam no banco.",
    };
    expect(sessionBanner("disconnected")).toEqual(restart);
    expect(sessionBanner("disconnected", "invalid-session")).toEqual(restart);
    expect(sessionBanner("disconnected", "reconnect-exhausted")).toEqual(restart);
    expect(sessionBanner("disconnected", "428")).toEqual(restart);
    expect(sessionBanner("disconnected", "ECONNREFUSED 127.0.0.1:5432")).toEqual(
      restart,
    );
  });
});
