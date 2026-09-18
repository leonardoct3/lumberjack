import { describe, expect, it } from "vitest";
import { hasVisibleInboxWork, orphanWhere } from "@/features/inbox/queries";

describe("visible Inbox work", () => {
  it("uses the same muted, duplicate, and dismissal rules as the Inbox", () => {
    expect(orphanWhere(false)).toMatchObject({
      duplicateOfId: null,
      dismissedAt: null,
      sender: { muted: false },
    });
  });

  it("does not send the operator to Inbox when neither visible queue has work", async () => {
    const db = {
      partyCandidate: { count: async () => 0 },
      message: { count: async () => 0 },
    };
    await expect(hasVisibleInboxWork(db as never)).resolves.toBe(false);
  });

  it("detects either visible queue", async () => {
    const db = {
      partyCandidate: { count: async () => 1 },
      message: { count: async () => 0 },
    };
    await expect(hasVisibleInboxWork(db as never)).resolves.toBe(true);
  });
});
