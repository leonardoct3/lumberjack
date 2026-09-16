import { describe, it, expect } from "vitest";
import { classifyMessage } from "@/domain/classify";

function pista(text: string) {
  return classifyMessage({ senderRole: "pista", text });
}

describe("classifyMessage", () => {
  it("marks admin lot/link as admin_promo", () => {
    expect(
      classifyMessage({
        senderRole: "admin",
        text: "Abriu o 1º lote da ONIX https://www.sympla.com.br/onix",
      }),
    ).toBe("admin_promo");
  });

  it("does not treat admin hello as promo", () => {
    expect(classifyMessage({ senderRole: "admin", text: "bom dia galera" })).toBe("ruido");
  });

  it("never classifies admin as pista", () => {
    expect(classifyMessage({ senderRole: "admin", text: "vendo extra onix" })).toBe("ruido");
  });

  it("prefers demand when both sides appear", () => {
    expect(pista("vendo nao, procuro onix")).toBe("pista_procura");
  });

  it("never classifies pista as admin_promo even with a link", () => {
    expect(pista("olha o link https://www.sympla.com.br/x")).toBe("ruido");
  });
});

describe("classifyMessage demand vocabulary", () => {
  // Every phrasing here showed up as `ruido` before, which is invisible in the
  // Inbox: the operator saw only offers and concluded nobody ever asks.
  it.each([
    "compro 2 pista",
    "compro 1 ingresso onix",
    "comprar 2 pista alguem?",
    "quem tem 2 pista?",
    "quem vende pista?",
    "quem ta vendendo pista?",
    "alguem vendendo pista?",
    "alguem ta vendendo?",
    "procura-se 1 pista",
    "procura 2 pistas",
    "procurando 1 pista",
    "busco 1 pista",
    "pago acima da tabela por 2",
    "pago 200 na pista",
    "quero 2 pista",
    "queria 1 ingresso",
    "interesse em 1 pista",
    "tenho interesse na pista",
    "preciso de 1 pista",
    "preciso de 2 pra hoje",
    "procuro 2 pista",
    "alguem tem pista?",
    "tem alguem com pista?",
  ])("reads %s as demand", (text) => {
    expect(pista(text)).toBe("pista_procura");
  });
});

describe("classifyMessage offer vocabulary", () => {
  it.each([
    "vendo 2 pista",
    "vendendo 1 pista",
    "tenho extra",
    "revendo 1 pista",
    "revenda de 2 pista",
    "sobrou 1 pista",
    "passo 2 pista pelo valor",
    "transfiro 1 pista",
    "repasso 1 ingresso",
    "disponivel 2 pista",
    "pista a venda",
    "saida de 1 pista",
    "saida onix hoje",
    // A seller's call to action mentions interest, which is a demand word.
    "vendo 2 pista, alguem interessado?",
    "tenho 2 pista, quem quer?",
  ])("reads %s as offer", (text) => {
    expect(pista(text)).toBe("pista_oferta");
  });
});

describe("classifyMessage restraint", () => {
  // Weak words only count next to a ticket noun, or the Inbox fills with chat.
  it.each([
    "bom dia galera",
    "alguem sabe que horas abre?",
    "mando o comprovante depois",
    "ja passou o horario",
    "quero ir nessa",
    "pago no pix quando chegar",
    "sobrou muita gente na fila",
    "preciso dormir",
    "2 pista",
    "obrigado!",
  ])("leaves %s as ruido", (text) => {
    expect(pista(text)).toBe("ruido");
  });

  it("does not read a payment receipt as buying", () => {
    expect(pista("segue o comprovante da pista")).toBe("ruido");
  });
});
