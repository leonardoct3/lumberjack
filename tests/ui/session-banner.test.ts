import { describe, expect, it } from "vitest";
import type { WaStatus } from "@/connector/status";
import {
  HEARTBEAT_STALE_MS,
  TRAFFIC_STALE_MS,
  monitorNavState,
  sessionBanner,
} from "@/components/ui/session-banner";

const CONNECTED_AT = "2026-09-09T19:00:00.000Z";
const NOW = Date.parse("2026-09-09T19:10:00.000Z");

function status(over: Partial<WaStatus> = {}): WaStatus {
  return {
    state: "connected",
    updatedAt: CONNECTED_AT,
    heartbeatAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function minutesAfter(minutes: number): number {
  return Date.parse(CONNECTED_AT) + minutes * 60_000;
}

describe("sessionBanner", () => {
  it("hides the bar when connected and messages are flowing", () => {
    expect(
      sessionBanner(
        status({ lastMessageAt: "2026-09-09T19:09:00.000Z" }),
        NOW,
      ),
    ).toBeNull();
  });

  it("stays quiet right after connecting, before any message arrives", () => {
    expect(sessionBanner(status(), NOW)).toBeNull();
  });

  it("warns when the session connected but never delivered a message", () => {
    const now = minutesAfter(TRAFFIC_STALE_MS / 60_000 + 1);
    const guidance = sessionBanner(
      status({ heartbeatAt: new Date(now).toISOString() }),
      now,
    );
    expect(guidance?.tone).toBe("danger");
    expect(guidance?.kind).toBe("traffic-stale");
    expect(guidance?.visibility).toBe("global");
    expect(guidance?.title).toBe("Conectado, mas sem mensagens chegando");
    expect(guidance?.step).toBe(
      "Reinicie o connector. Se seguir sem tráfego, pare tudo, apague data/wa-auth/ e escaneie um QR novo.",
    );
  });

  it("warns when traffic stops after having flowed", () => {
    const now = minutesAfter(TRAFFIC_STALE_MS / 60_000 + 1);
    const guidance = sessionBanner(
      status({
        lastMessageAt: CONNECTED_AT,
        heartbeatAt: new Date(now).toISOString(),
      }),
      now,
    );
    expect(guidance?.title).toBe("Conectado, mas sem mensagens chegando");
  });

  it("measures silence from the last message, not from the connection", () => {
    const now = minutesAfter(45);
    const guidance = sessionBanner(
      status({
        lastMessageAt: "2026-09-09T19:40:00.000Z",
        heartbeatAt: new Date(now).toISOString(),
      }),
      now,
    );
    expect(guidance).toBeNull();
  });

  it("flags a dead connector when the heartbeat goes stale", () => {
    const guidance = sessionBanner(
      status({
        lastMessageAt: "2026-09-09T19:09:00.000Z",
        heartbeatAt: CONNECTED_AT,
      }),
      minutesAfter(HEARTBEAT_STALE_MS / 60_000 + 1),
    );
    expect(guidance?.tone).toBe("danger");
    expect(guidance?.kind).toBe("heartbeat-stale");
    expect(guidance?.title).toBe("Monitor fora do ar");
    expect(guidance?.step).toBe(
      "O connector parou de responder. Reinicie o serviço e confira os logs.",
    );
  });

  it("asks for the QR scan with an accent when a code is waiting", () => {
    const guidance = sessionBanner(status({ state: "qr" }), NOW);
    expect(guidance?.tone).toBe("accent");
    expect(guidance?.kind).toBe("qr");
    expect(guidance?.visibility).toBe("setup");
    expect(guidance?.title).toBe("WhatsApp aguardando leitura do QR");
    expect(guidance?.step).toBe(
      "Abra Setup e escaneie o código em WhatsApp › Aparelhos conectados › Conectar aparelho.",
    );
  });

  it("tells the operator to start the connector when no session was ever written", () => {
    const guidance = sessionBanner(
      status({ state: "disconnected", detail: "missing-session" }),
      NOW,
    );
    expect(guidance?.tone).toBe("accent");
    expect(guidance?.kind).toBe("missing-session");
    expect(guidance?.visibility).toBe("setup");
    expect(guidance?.title).toBe("Monitor não configurado");
    expect(guidance?.step).toBe(
      "Suba o connector e escaneie o QR que aparece em Setup.",
    );
  });

  it("tells the operator to clear the auth folder when the phone unlinked the session", () => {
    const guidance = sessionBanner(
      status({ state: "disconnected", detail: "401" }),
      NOW,
    );
    expect(guidance?.tone).toBe("danger");
    expect(guidance?.title).toBe("Sessão desconectada pelo celular");
    expect(guidance?.step).toBe(
      "Pare o connector, apague data/wa-auth/ e reinicie para gerar um QR novo em Setup.",
    );
  });

  it("tells the operator to restart the connector for any other drop", () => {
    const restart = {
      kind: "disconnected",
      tone: "danger",
      visibility: "global",
      title: "Monitor fora do ar",
      step: "Reinicie o connector para reconectar. As mensagens já salvas continuam no banco.",
    };
    for (const detail of [
      undefined,
      "invalid-session",
      "reconnect-exhausted",
      "428",
      "ECONNREFUSED 127.0.0.1:5432",
      // Written by the connector's own shutdown paths.
      "stopped",
      "crash",
    ]) {
      expect(
        sessionBanner(status({ state: "disconnected", detail }), NOW),
      ).toEqual(restart);
    }
  });
});

describe("monitorNavState", () => {
  it("shows a healthy connected state when no guidance is needed", () => {
    expect(monitorNavState(null)).toEqual({
      tone: "active",
      title: "Monitor ativo",
      description: "WhatsApp conectado",
    });
  });

  it("turns initial setup into a persistent attention state", () => {
    const guidance = sessionBanner(
      status({ state: "disconnected", detail: "missing-session" }),
      NOW,
    );
    expect(monitorNavState(guidance)).toEqual({
      tone: "attention",
      title: "Monitor não configurado",
      description: "Configurar no Setup",
    });
  });

  it("keeps operational failures visible as danger states", () => {
    const guidance = sessionBanner(
      status({ state: "disconnected", detail: "401" }),
      NOW,
    );
    expect(monitorNavState(guidance)).toEqual({
      tone: "danger",
      title: "Sessão desconectada",
      description: "Reconectar no Setup",
    });
  });

  it("distinguishes QR pairing from initial setup", () => {
    const guidance = sessionBanner(status({ state: "qr" }), NOW);
    expect(monitorNavState(guidance)).toEqual({
      tone: "attention",
      title: "Aguardando QR",
      description: "Concluir no Setup",
    });
  });

  it("summarizes stale traffic without hiding the global outage", () => {
    const now = minutesAfter(TRAFFIC_STALE_MS / 60_000 + 1);
    const guidance = sessionBanner(
      status({ heartbeatAt: new Date(now).toISOString() }),
      now,
    );
    expect(guidance?.visibility).toBe("global");
    expect(monitorNavState(guidance)).toEqual({
      tone: "danger",
      title: "Sem mensagens chegando",
      description: "Verificar no Setup",
    });
  });
});
