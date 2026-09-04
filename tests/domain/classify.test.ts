import { describe, it, expect } from "vitest";
import { classifyMessage } from "@/domain/classify";

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

  it("classifies demand", () => {
    expect(
      classifyMessage({ senderRole: "pista", text: "procuro pista onix sexta" }),
    ).toBe("pista_procura");
  });

  it("classifies offer", () => {
    expect(classifyMessage({ senderRole: "unknown", text: "vendo camarote" })).toBe(
      "pista_oferta",
    );
  });

  it("prefers demand when both appear", () => {
    expect(
      classifyMessage({ senderRole: "pista", text: "vendo nao, procuro onix" }),
    ).toBe("pista_procura");
  });

  it("never classifies pista as admin_promo even with a link", () => {
    expect(
      classifyMessage({
        senderRole: "pista",
        text: "olha o link https://www.sympla.com.br/x",
      }),
    ).toBe("ruido");
  });
});
