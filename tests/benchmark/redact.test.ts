import { describe, expect, it } from "vitest";
import { redactText } from "@/benchmark/redact";

describe("redactText", () => {
  it("removes Brazilian phone numbers in the ways people write them", () => {
    for (const phone of [
      "+55 11 99999-0000",
      "(11) 99999-0000",
      "11 999990000",
      "5511999990000",
      "99999-0000",
    ]) {
      const { text } = redactText(`chama no ${phone} que eu passo`);
      expect(text).toBe("chama no [PHONE] que eu passo");
    }
  });

  it("removes the number behind a WhatsApp mention", () => {
    expect(redactText("@5511999990000 ainda tem?").text).toBe("@[PHONE] ainda tem?");
  });

  it("removes emails, CPFs, CNPJs and random PIX keys", () => {
    const { text, counts } = redactText(
      "pix joao.silva@gmail.com ou 123.456.789-09 ou 12.345.678/0001-90 ou 123e4567-e89b-12d3-a456-426614174000",
    );
    expect(text).toBe("pix [EMAIL] ou [DOCUMENT] ou [DOCUMENT] ou [PIX_KEY]");
    expect(counts).toMatchObject({ email: 1, document: 2, pixKey: 1 });
  });

  it("keeps what the benchmark needs: prices, dates, times, quantities", () => {
    const source =
      "vendo 2 pista onix 27/12/2026 23:59 R$ 1.120,00 ou R$250, 2º lote, réveillon 2026-2027";
    expect(redactText(source).text).toBe(source);
  });

  it("strips the phone out of wa.me links but keeps that it was a sales channel", () => {
    expect(redactText("compra aqui https://wa.me/5511999990000?text=oi").text).toBe(
      "compra aqui https://wa.me/[PHONE]",
    );
    expect(redactText("compra aqui wa.me/5511999990000").text).toBe(
      "compra aqui wa.me/[PHONE]",
    );
  });

  it("drops tracking and personal query parameters but keeps the event identity", () => {
    const { text, counts } = redactText(
      "*ONIX* https://www.sympla.com.br/evento/onix-festival/2712345?utm_source=wa&fbclid=abc&d=joao%40gmail.com&lote=2).",
    );
    expect(text).toBe(
      "*ONIX* https://www.sympla.com.br/evento/onix-festival/2712345?lote=2).",
    );
    expect(counts.urlParam).toBe(3);
  });

  it("leaves a clean link exactly as it was written", () => {
    const source = "https://www.sympla.com.br/evento/onix/2712345";
    expect(redactText(source).text).toBe(source);
  });

  it("does not mistake an event id inside a link for a phone", () => {
    const source = "https://gandaya.com.br/e/11999990000";
    expect(redactText(source).text).toBe(source);
  });

  it("removes long bare digit runs that can only be documents or accounts", () => {
    expect(redactText("cpf 12345678909 pix").text).toBe("cpf [NUMBER] pix");
  });

  it("removes known sender names as whole words, whatever the case or accents", () => {
    const { text, counts } = redactText("valeu GUILHERME, fala com a júlia", {
      knownNames: ["Guilherme Souza", "Júlia"],
    });
    expect(text).toBe("valeu [NAME], fala com a [NAME]");
    expect(counts.name).toBe(2);
  });

  it("never redacts a name that is also an event name", () => {
    const { text } = redactText("vendo pista onix", {
      knownNames: ["Onix Eventos"],
      protectedTerms: ["ONIX Festival"],
    });
    expect(text).toBe("vendo pista onix");
  });

  it("ignores name fragments too short to be identifying", () => {
    expect(redactText("a pista do jo", { knownNames: ["Jo"] }).text).toBe(
      "a pista do jo",
    );
  });
});
