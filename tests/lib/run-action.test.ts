import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { runAction } = await import("@/lib/run-action");
const { FAIL_TOAST } = await import("@/lib/toast-copy");

describe("runAction", () => {
  beforeEach(() => {
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it("reports success, toasts and refreshes", async () => {
    const refresh = vi.fn();
    const ok = await runAction(async () => {}, new FormData(), "Salvo", refresh);

    expect(ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Salvo");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("offers to undo what the action returned, and only when there is something", async () => {
    const onUndo = vi.fn();
    const undo = (value: { linked: string[] }) => (value.linked.length ? onUndo : null);

    await runAction(
      async () => ({ linked: ["m-1"] }),
      new FormData(),
      "Feito",
      vi.fn(),
      undo,
    );
    await runAction(
      async () => ({ linked: [] }),
      new FormData(),
      "Feito",
      vi.fn(),
      undo,
    );

    expect(toast.success).toHaveBeenNthCalledWith(1, "Feito", {
      action: { label: "Desfazer", onClick: onUndo },
    });
    expect(toast.success).toHaveBeenNthCalledWith(2, "Feito");
  });

  it("reports failure and does not refresh when the action throws", async () => {
    const refresh = vi.fn();
    const ok = await runAction(
      async () => {
        throw new Error("boom");
      },
      new FormData(),
      "Salvo",
      refresh,
    );

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(FAIL_TOAST);
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
