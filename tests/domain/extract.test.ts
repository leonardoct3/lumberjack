import { describe, it, expect } from "vitest";
import { extractCandidate } from "@/domain/extract";

const now = new Date("2026-09-03T15:00:00Z");

describe("extractCandidate", () => {
  it("pulls url, platform, lot, price, date, name", () => {
    const r = extractCandidate(
      "ONIX\n1º lote R$ 80 05/09 https://www.sympla.com.br/onix",
      now,
    );
    expect(r.platform).toBe("sympla");
    expect(r.url).toContain("sympla.com.br/onix");
    expect(r.officialPrice).toBe(80);
    expect(r.lotLabel?.toLowerCase()).toContain("lote");
    expect(r.eventAt?.toISOString().startsWith("2026-09-05")).toBe(true);
    expect(r.name?.toLowerCase()).toContain("onix");
  });

  it("takes the festa name from the bold segment of an ad", () => {
    const r = extractCandidate(
      "⚠️ *Meio Advogado* 🎟️ 25.09 VIRADA DE LOTE HOJE 23h59 SEM TAXA https://wa.me/5511998845595 Aluno R$255",
      now,
    );
    expect(r.name).toBe("Meio Advogado");
    expect(r.officialPrice).toBe(255);
    expect(r.eventAt?.toISOString().startsWith("2026-09-25")).toBe(true);
  });

  it("does not read a thousands separator as a date", () => {
    const r = extractCandidate("*Araxás* pacote Fem R$2.750 | Masc R$1.120", now);
    expect(r.eventAt).toBeNull();
    expect(r.officialPrice).toBe(2.75);
  });

  it("skips a number pair that cannot be a date", () => {
    const r = extractCandidate("*ONIX* lote 3/50 esgotado, vira 31.12", now);
    expect(r.eventAt?.toISOString().startsWith("2026-12-31")).toBe(true);
  });

  it("keeps the festa when the pitch is glued onto its name", () => {
    const r = extractCandidate(
      "*MACK BIXOS - VIRADA DE LOTE 23:59* Essa sexta, Paradoxo. *Link para compra:* https://blacktag.com.br/eventos/32638/mackbixos-mare *Sem taxa via pix:* https://wa.me/message/X4C *Fique por dentro dos melhores eventos no grupo abaixo:* https://chat.whatsapp.com/GD8",
      now,
    );
    expect(r.name).toBe("MACK BIXOS");
  });

  it("does not cut a name in half when the tail is not a pitch", () => {
    const r = extractCandidate("*CENTRAL 1926 - VOLT MIX* sexta 18.09", now);
    expect(r.name).toBe("CENTRAL 1926 - VOLT MIX");
  });

  it("skips a bold weekday and a bold free entry", () => {
    const r = extractCandidate(
      "🍸 *QUINTA - 17.09* 🎉 *GRÁTIS* até 22h *Galleria Bar* listas",
      now,
    );
    expect(r.name).toBe("Galleria Bar");
  });

  it("skips bold sales pitch and keeps looking for the name", () => {
    const r = extractCandidate(
      "🔗 *Cupom desconto:* CODELIS\n🌊 *RÉVEILLON AREIA BÚZIOS* 🌊 27.12 a 02.01",
      now,
    );
    expect(r.name).toBe("RÉVEILLON AREIA BÚZIOS");
  });

  it("falls back to the first line when every bold part is a pitch", () => {
    const r = extractCandidate(
      "27/12 a 02/01 AVULSOS VENDAS ABERTAS *COM DESCONTO* https://cart.ingresse.com/x",
      now,
    );
    expect(r.name).toBe("27/12 a 02/01 AVULSOS VENDAS ABERTAS");
  });

  it("ignores bold dates and prices", () => {
    const r = extractCandidate("*31.12* ONIX FESTIVAL *R$180*", now);
    expect(r.name).toBe("ONIX FESTIVAL");
  });

  it("returns nulls when nothing is present", () => {
    const r = extractCandidate("bom dia", now);
    expect(r).toEqual({
      name: "bom dia",
      url: null,
      lotLabel: null,
      officialPrice: null,
      eventAt: null,
      platform: "unknown",
    });
  });
});
