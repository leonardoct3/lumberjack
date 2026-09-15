import type { WaStatus } from "@/connector/status";

export type BannerTone = "accent" | "danger";
export type SessionGuidanceKind =
  | "heartbeat-stale"
  | "traffic-stale"
  | "qr"
  | "missing-session"
  | "logged-out"
  | "disconnected";

/** What is wrong with the WhatsApp session and the one thing the operator should do next. */
export type SessionGuidance = {
  kind: SessionGuidanceKind;
  tone: BannerTone;
  visibility: "setup" | "global";
  title: string;
  step: string;
};

export type MonitorNavState = {
  tone: "active" | "attention" | "danger";
  title: string;
  description: string;
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
        kind: "heartbeat-stale",
        tone: "danger",
        visibility: "global",
        title: "Monitor fora do ar",
        step: "O connector parou de responder. Reinicie o serviço e confira os logs.",
      };
    }

    // Before the first message the connection time is the only reference we have.
    const heardAt = Date.parse(status.lastMessageAt ?? status.updatedAt);
    if (Number.isNaN(heardAt) || now - heardAt <= TRAFFIC_STALE_MS) return null;
    return {
      kind: "traffic-stale",
      tone: "danger",
      visibility: "global",
      title: "Conectado, mas sem mensagens chegando",
      step: "Reinicie o connector. Se seguir sem tráfego, pare tudo, apague data/wa-auth/ e escaneie um QR novo.",
    };
  }

  if (state === "qr") {
    return {
      kind: "qr",
      tone: "accent",
      visibility: "setup",
      title: "WhatsApp aguardando leitura do QR",
      step: "Abra Setup e escaneie o código em WhatsApp › Aparelhos conectados › Conectar aparelho.",
    };
  }

  if (detail === "missing-session") {
    return {
      kind: "missing-session",
      tone: "accent",
      visibility: "setup",
      title: "Monitor não configurado",
      step: "Suba o connector e escaneie o QR que aparece em Setup.",
    };
  }

  if (detail === LOGGED_OUT_CODE) {
    return {
      kind: "logged-out",
      tone: "danger",
      visibility: "global",
      title: "Sessão desconectada pelo celular",
      step: "Pare o connector, apague data/wa-auth/ e reinicie para gerar um QR novo em Setup.",
    };
  }

  return {
    kind: "disconnected",
    tone: "danger",
    visibility: "global",
    title: "Monitor fora do ar",
    step: "Reinicie o connector para reconectar. As mensagens já salvas continuam no banco.",
  };
}

/** Compact, persistent state shown in navigation on every authenticated page. */
export function monitorNavState(
  guidance: SessionGuidance | null,
): MonitorNavState {
  if (!guidance) {
    return {
      tone: "active",
      title: "Monitor ativo",
      description: "WhatsApp conectado",
    };
  }

  if (guidance.kind === "missing-session") {
    return {
      tone: "attention",
      title: "Monitor não configurado",
      description: "Configurar no Setup",
    };
  }

  if (guidance.kind === "qr") {
    return {
      tone: "attention",
      title: "Aguardando QR",
      description: "Concluir no Setup",
    };
  }

  if (guidance.kind === "traffic-stale") {
    return {
      tone: "danger",
      title: "Sem mensagens chegando",
      description: "Verificar no Setup",
    };
  }

  if (guidance.kind === "logged-out") {
    return {
      tone: "danger",
      title: "Sessão desconectada",
      description: "Reconectar no Setup",
    };
  }

  return {
    tone: "danger",
    title: "Monitor fora do ar",
    description: "Resolver no Setup",
  };
}

/** Baileys writes the raw status code; 401 means the phone dropped the pairing. */
const LOGGED_OUT_CODE = "401";
