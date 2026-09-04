import { describe, expect, it } from "vitest";
import { FAIL_TOAST, TOAST } from "@/lib/toast-copy";

describe("toast copy", () => {
  it("fail message is the locked sentence", () => {
    expect(FAIL_TOAST).toBe("Não deu. Tenta de novo.");
  });

  it("success verbs match the spec", () => {
    expect(TOAST.up).toBe("Subiu");
    expect(TOAST.confirmed).toBe("Festa confirmada");
    expect(TOAST.unlinked).toBe("Desvinculado");
  });
});
