export type BannerTone = "accent" | "danger";

/** What is wrong with the WhatsApp session and the one thing the operator should do next. */
export type SessionGuidance = {
  tone: BannerTone;
  title: string;
  step: string;
};

/** `detail` comes from the status file, so the step matches why the session is down. */
export function sessionBanner(
  state: "connected" | "qr" | "disconnected",
  detail?: string,
): SessionGuidance | null {
  if (state === "connected") return null;

  if (state === "qr") {
    return {
      tone: "accent",
      title: "WhatsApp aguardando leitura do QR",
      step: "Abra o terminal do connector e escaneie o código em WhatsApp › Aparelhos conectados.",
    };
  }

  if (detail === "missing-session") {
    return {
      tone: "danger",
      title: "Monitor nunca foi ligado",
      step: "Rode npm run connector e escaneie o QR que aparece no terminal.",
    };
  }

  if (detail === LOGGED_OUT_CODE) {
    return {
      tone: "danger",
      title: "Sessão desconectada pelo celular",
      step: "Pare o connector, apague data/wa-auth/ e rode npm run connector para gerar um QR novo.",
    };
  }

  return {
    tone: "danger",
    title: "Monitor fora do ar",
    step: "Rode npm run connector para reconectar. As mensagens já salvas continuam no banco.",
  };
}

/** Baileys writes the raw status code; 401 means the phone dropped the pairing. */
const LOGGED_OUT_CODE = "401";
