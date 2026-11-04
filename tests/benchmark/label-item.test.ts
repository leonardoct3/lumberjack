import { describe, expect, it } from "vitest";
import type { LoadedExport } from "@/benchmark/dataset";
import type { ExportedMessage } from "@/benchmark/export";
import { buildItemView, labelQueue, type LabelItem } from "@/benchmark/label/item";

const HOUR = 3_600_000;
const t0 = Date.parse("2026-09-18T15:00:00Z");
const at = (hours: number) => new Date(t0 + hours * HOUR).toISOString();

function message(
  id: string,
  hours: number,
  over: Partial<ExportedMessage> = {},
): ExportedMessage {
  return {
    id,
    group: "grp_a",
    sender: "snd_x",
    sentAt: at(hours),
    createdAt: at(hours),
    text: `text of ${id}`,
    storedClass: "pista_oferta",
    partyId: "party-1",
    duplicateOf: null,
    dismissed: false,
    inInterval: true,
    senderRoleNow: "pista",
    senderMutedNow: false,
    ...over,
  };
}

function exportWith(messages: ExportedMessage[]): LoadedExport {
  return {
    dir: "/tmp/x",
    manifest: {} as LoadedExport["manifest"],
    messages,
    parties: [
      {
        id: "party-1",
        name: "Onix",
        aliases: ["onix fest"],
        eventAt: at(72),
        statusNow: "upcoming",
        createdAt: at(-48),
      },
      {
        id: "party-later",
        name: "Later",
        aliases: [],
        eventAt: at(96),
        statusNow: "upcoming",
        createdAt: at(1),
      },
      {
        id: "party-past",
        name: "Past",
        aliases: [],
        eventAt: at(-24),
        statusNow: "past",
        createdAt: at(-200),
      },
    ],
    lots: [
      {
        id: "lot-1",
        partyId: "party-1",
        label: "1º lote",
        openedAt: at(-30),
        closedAt: null,
        officialPrice: 120,
        url: null,
        platform: "sympla",
      },
      {
        id: "lot-2",
        partyId: "party-1",
        label: "2º lote",
        openedAt: at(2),
        closedAt: null,
        officialPrice: 150,
        url: null,
        platform: "sympla",
      },
    ],
    candidates: [],
  };
}

function item(messageId: string, over: Partial<LabelItem> = {}): LabelItem {
  return {
    familyId: `fam-${messageId}`,
    messageId,
    members: [messageId],
    set: "random",
    selectedBy: null,
    tags: [],
    inclusionProbability: 0.5,
    split: "development",
    excluded: null,
    ...over,
  };
}

describe("buildItemView", () => {
  const data = exportWith([
    message("target", 0),
    message("group-recent", -2, { sender: "snd_y" }),
    message("group-stale", -25, { sender: "snd_y" }),
    message("sender-elsewhere", -100, { group: "grp_b" }),
    message("sender-too-old", -24 * 7 - 1, { group: "grp_b" }),
    message("both-windows", -1),
    message("same-instant", 0, { sender: "snd_y" }),
    message("later", 1, { sender: "snd_y" }),
    message("other-group", -1, { group: "grp_c", sender: "snd_z" }),
  ]);

  it("offers only what was already said, in the group's last day and the sender's last week", () => {
    const view = buildItemView(data, item("target", { members: ["target", "copy"] }));
    expect(view.context.map((c) => [c.id, c.sameGroup, c.sameSender])).toEqual([
      ["both-windows", true, true],
      ["group-recent", true, false],
      ["sender-elsewhere", false, true],
    ]);
    expect(view.familySize).toBe(2);
  });

  it("shows the catalog as it stood, with only the lots already open", () => {
    const view = buildItemView(data, item("target"));
    expect(view.catalog).toEqual([
      {
        id: "party-1",
        name: "Onix",
        aliases: ["onix fest"],
        eventAt: at(72),
        lots: [{ label: "1º lote", officialPrice: 120, platform: "sympla" }],
      },
    ]);
    expect(view.availableContext).toEqual([
      "both-windows",
      "group-recent",
      "sender-elsewhere",
      "party-1",
    ]);
  });

  it("never shows what the rules decided", () => {
    const json = JSON.stringify(buildItemView(data, item("target")));
    expect(json).not.toMatch(/storedClass|pista_oferta|"partyId"/);
  });

  it("caps each window at the 30 newest messages", () => {
    const crowd = Array.from({ length: 40 }, (_, i) =>
      message(`m${i}`, -(i + 1) / 10, { sender: `snd_${i}` }),
    );
    const view = buildItemView(
      exportWith([message("target", 0), ...crowd]),
      item("target"),
    );
    expect(view.context).toHaveLength(30);
    expect(view.context[0].id).toBe("m0");
  });
});

describe("labelQueue", () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    item(`msg_${i}`, i === 3 ? { excluded: "template_leak" } : {}),
  );

  it("is the same order every time for a seed, and not the sample's order", () => {
    const a = labelQueue(items, "seed-1").map((i) => i.messageId);
    expect(labelQueue([...items].reverse(), "seed-1").map((i) => i.messageId)).toEqual(
      a,
    );
    expect(labelQueue(items, "seed-2").map((i) => i.messageId)).not.toEqual(a);
  });

  it("leaves the items kept out of evaluation for last", () => {
    expect(labelQueue(items, "seed-1").at(-1)?.messageId).toBe("msg_3");
  });
});
