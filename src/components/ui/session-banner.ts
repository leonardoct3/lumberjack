import type { WaStatus } from "@/connector/status";

export type BannerTone = "accent" | "danger";

/** What is wrong with the WhatsApp session and the one thing the operator should do next. */
export type SessionGuidance = {
  tone: BannerTone;
  title: string;
  step: string;
};

/**
 * An account in hundreds of groups always has traffic, so this much silence means
 * WhatsApp accepted the socket and stopped delivering — a failure the `open` event hides.
 */
export const TRAFFIC_STALE_MS = 30 * 60 * 1000;

/**
 * Connector writes a heartbeat every ~60s. Longer than this without a pulse means the
 * process is gone even if the last row still says `connected`.
 */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/** `detail` comes from the WaSession row, so the step matches why the session is down. */
export function sessionBanner(
  status: WaStatus,
  now: number,
): SessionGuidance | null {
  const { state, detail } = status;

  if (state === "connected") {
    const heartbeatAt = status.heartbeatAt
      ? Date.parse(status.heartbeatAt)
      : Number.NaN;
    if (
      !Number.isNaN(heartbeatAt) &&
      now - heartbeatAt > HEARTBEAT_STALE_MS
    ) {
      return {
        tone: "danger",
        title: "Monitor fora do ar",
        step: "O connector parou de responder. Reinicie o serviço e confira os logs.",
      };
    }

    // Before the first message the connection time is the only reference we have.
    const heardAt = Date.parse(status.lastMessageAt ?? status.updatedAt);
    if (Number.isNaN(heardAt) || now - heardAt <= TRAFFIC_STALE_MS) return null;
    return {
      tone: "danger",
      title: "Conectado, mas sem mensagens chegando",
      step: "Reinicie o connector. Se seguir sem tráfego, pare tudo, apague data/wa-auth/ e escaneie um QR novo.",
    };
  }

  if (state === "qr") {
    return {
      tone: "accent",
      title: "WhatsApp aguardando leitura do QR",
      step: "Abra Setup e escaneie o código em WhatsApp › Aparelhos conectados › Conectar aparelho.",
    };
  }

  if (detail === "missing-session") {
    return {
      tone: "danger",
      title: "Monitor nunca foi ligado",
      step: "Suba o connector e escaneie o QR que aparece em Setup.",
    };
  }

  if (detail === LOGGED_OUT_CODE) {
    return {
      tone: "danger",
      title: "Sessão desconectada pelo celular",
      step: "Pare o connector, apague data/wa-auth/ e reinicie para gerar um QR novo em Setup.",
    };
  }

  return {
    tone: "danger",
    title: "Monitor fora do ar",
    step: "Reinicie o connector para reconectar. As mensagens já salvas continuam no banco.",
  };
}

/** Baileys writes the raw status code; 401 means the phone dropped the pairing. */
const LOGGED_OUT_CODE = "401";
