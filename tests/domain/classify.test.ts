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

describe("classifyMessage promoter blasts", () => {
  // Real texts from the board. None of these senders administers the group,
  // so they used to sit in ruído while the candidate queue stayed empty.
  it.each([
    "⚠️ *Araxás* 📅 27/12 a 02/01 ÚLTIMOS INGRESSOS DO LOTE ATUAL *SEM TAXA VIA PIX* https://wa.me/5511998845595 Pacote - Fem R$2.750 | Masc R$3.150",
    "⚠️ *Meio Advogado* 25.09 VIRADA DE LOTE HOJE 23h59 SEM TAXA https://wa.me/5511998845595 Aluno R$255 Não aluno R$290 https://blacktag.com.br/eventos/32960",
    "⚠️ *SUPER TENDA* 03:10 🔗 https://bit.ly/FestasLiga PIX (sem taxa) Pista R$125 Front R$205 Super VIP R$255",
    "⚠️ 27/12 a 02/01 AVULSOS VENDAS ABERTAS (somente pelo link) *COM DESCONTO* https://cart.ingresse.com/f95a273a/tickets?coupon=CG",
  ])("reads an ad as a candidate: %s", (text) => {
    expect(pista(text)).toBe("admin_promo");
  });

  it("leaves a guest list on an unknown host undecided", () => {
    expect(
      pista(
        "*Motirô* _coloque seu nome na lista VIP_ Quarta - Dia de Feira https://www.pensanoevento.com.br/nomenalista/108274",
      ),
    ).toBe("ruido");
  });

  it("keeps a pista offer that carries a sales link and a price", () => {
    expect(
      pista("vendo 1 pista onix R$150 https://www.sympla.com.br/evento/onix"),
    ).toBe("pista_oferta");
  });

  it("keeps a buyer who quotes the official price", () => {
    expect(pista("compro 2 pista, pago os R$180 do lote https://wa.me/551199")).toBe(
      "pista_procura",
    );
  });

  it("does not turn one lonely link into a candidate", () => {
    expect(pista("olha o link https://www.sympla.com.br/x")).toBe("ruido");
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
