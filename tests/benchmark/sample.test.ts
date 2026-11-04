import { describe, expect, it } from "vitest";
import type { ExportedMessage } from "@/benchmark/export";
import {
  assignSplits,
  buildFamilies,
  challengeTags,
  drawSample,
  type Family,
} from "@/benchmark/sample";

let n = 0;
function msg(overrides: Partial<ExportedMessage> = {}): ExportedMessage {
  n += 1;
  return {
    id: `msg_${String(n).padStart(4, "0")}`,
    group: "grp_1",
    sender: `snd_${n}`,
    sentAt: new Date(Date.UTC(2026, 8, 15, 12, n)).toISOString(),
    createdAt: new Date(Date.UTC(2026, 8, 15, 12, n)).toISOString(),
    text: `mensagem ${n}`,
    storedClass: "ruido",
    partyId: null,
    duplicateOf: null,
    dismissed: false,
    inInterval: true,
    senderRoleNow: "unknown",
    senderMutedNow: false,
    ...overrides,
  };
}

describe("buildFamilies", () => {
  it("collapses cross-posted copies into one family led by the canonical message", () => {
    const original = msg();
    const copy = msg({ duplicateOf: original.id, group: "grp_2" });
    const families = buildFamilies([original, copy]);
    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({
      id: original.id,
      representative: original,
      members: [original.id, copy.id],
    });
  });

  it("leaves out families that only exist in the context window", () => {
    expect(buildFamilies([msg({ inInterval: false })])).toEqual([]);
  });

  it("lets a copy inside the interval stand in for a canonical before it", () => {
    const before = msg({ inInterval: false });
    const copy = msg({ duplicateOf: before.id });
    const [family] = buildFamilies([before, copy]);
    expect(family.id).toBe(before.id);
    expect(family.representative).toBe(copy);
  });
});

function families(count: number): Family[] {
  return buildFamilies(Array.from({ length: count }, () => msg()));
}

describe("drawSample", () => {
  const pool = families(40);

  it("is reproducible for a seed and different for another", () => {
    const a = drawSample(pool, {
      seed: "s1",
      randomSize: 10,
      perTag: 0,
      tagsOf: () => [],
    });
    const b = drawSample(pool, {
      seed: "s1",
      randomSize: 10,
      perTag: 0,
      tagsOf: () => [],
    });
    const c = drawSample(pool, {
      seed: "s2",
      randomSize: 10,
      perTag: 0,
      tagsOf: () => [],
    });
    expect(a.items.map((i) => i.familyId)).toEqual(b.items.map((i) => i.familyId));
    expect(a.items.map((i) => i.familyId)).not.toEqual(c.items.map((i) => i.familyId));
  });

  it("records the inclusion probability of the random set", () => {
    const { items } = drawSample(pool, {
      seed: "s",
      randomSize: 10,
      perTag: 0,
      tagsOf: () => [],
    });
    expect(items).toHaveLength(10);
    expect(new Set(items.map((i) => i.inclusionProbability))).toEqual(new Set([0.25]));
    expect(items.every((i) => i.set === "random")).toBe(true);
  });

  it("takes everything when the pool is smaller than the sample", () => {
    const { items } = drawSample(families(3), {
      seed: "s",
      randomSize: 10,
      perTag: 0,
      tagsOf: () => [],
    });
    expect(items.map((i) => i.inclusionProbability)).toEqual([1, 1, 1]);
  });

  it("fills the challenge set per tag from families outside the random set", () => {
    const tagged = new Set(pool.slice(0, 12).map((f) => f.id));
    const sample = drawSample(pool, {
      seed: "s",
      randomSize: 10,
      perTag: 3,
      tagsOf: (f) => (tagged.has(f.id) ? ["orphan"] : []),
    });
    const random = new Set(
      sample.items.filter((i) => i.set === "random").map((i) => i.familyId),
    );
    const challenge = sample.items.filter((i) => i.set === "challenge");

    expect(challenge).toHaveLength(3);
    for (const item of challenge) {
      expect(random.has(item.familyId)).toBe(false);
      expect(item.selectedBy).toBe("orphan");
      expect(item.inclusionProbability).toBeNull();
    }
    const stats = sample.tagStats.orphan;
    expect(stats.population).toBe(12);
    expect(stats.selected).toBe(3);
    expect(stats.inRandom + stats.eligible).toBe(12);
  });

  it("keeps every tag on an item, so random items count toward challenge analysis", () => {
    const { items } = drawSample(pool, {
      seed: "s",
      randomSize: 40,
      perTag: 0,
      tagsOf: () => ["cross_post"],
    });
    expect(items.every((i) => i.tags.includes("cross_post"))).toBe(true);
  });
});

describe("challengeTags", () => {
  const parties = [
    { id: "p1", name: "ONIX", aliases: ["onix festival"] },
    { id: "p2", name: "ONIX", aliases: [] },
    { id: "p3", name: "Araxás", aliases: [] },
  ];
  const tags = (text: string, extra: Partial<ExportedMessage> = {}, ctx = {}) =>
    challengeTags(buildFamilies([msg({ text, ...extra })])[0], {
      candidateCount: 0,
      parties,
      ...ctx,
    });

  it("flags offer and demand messages the rules left without an event", () => {
    expect(tags("vendo pista", { storedClass: "pista_oferta" })).toContain("orphan");
    expect(
      tags("vendo pista", { storedClass: "pista_oferta", partyId: "p1" }),
    ).not.toContain("orphan");
  });

  it("flags blasts that name several events and names shared by several editions", () => {
    expect(tags("*ONIX* e *Araxás* nesse fds")).toEqual(
      expect.arrayContaining(["multi_event", "same_name_editions", "relative_date"]),
    );
  });

  it("flags mixed intentions, corrections, withdrawals and multiple prices", () => {
    expect(tags("vendo 1 pista e compro camarote")).toContain("mixed_intent");
    expect(tags("corrigindo: R$ 200 e não R$ 250")).toEqual(
      expect.arrayContaining(["correction_or_update", "multiple_prices"]),
    );
    expect(tags("vendido, obrigado")).toContain("withdrawal_claim");
  });

  it("flags dates without a year, ticket categories mixed, and slang", () => {
    expect(tags("dia 27/12 tem camarote e pista")).toEqual(
      expect.arrayContaining(["date_without_year", "category_mix"]),
    );
    expect(tags("saida onix hoje")).toContain("slang");
  });

  it("flags cross-posts, muted senders and multi-candidate blasts", () => {
    const original = msg({ senderMutedNow: true });
    const family = buildFamilies([original, msg({ duplicateOf: original.id })])[0];
    expect(challengeTags(family, { candidateCount: 2, parties })).toEqual(
      expect.arrayContaining(["cross_post", "muted_sender", "multi_candidate"]),
    );
  });
});

describe("assignSplits", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 8, day, 15)).toISOString();
  const bounds = {
    calibrationFrom: new Date(Date.UTC(2026, 8, 18, 3)),
    testFrom: new Date(Date.UTC(2026, 8, 22, 3)),
  };

  it("splits families chronologically by when they were first seen", () => {
    const fams = buildFamilies([
      msg({ sentAt: at(15) }),
      msg({ sentAt: at(19) }),
      msg({ sentAt: at(23) }),
    ]);
    expect(assignSplits(fams, bounds).map((s) => s.split)).toEqual([
      "development",
      "calibration",
      "test",
    ]);
  });

  it("excludes a family whose copies straddle a boundary", () => {
    const original = msg({ sentAt: at(17) });
    const [family] = buildFamilies([
      original,
      msg({ duplicateOf: original.id, sentAt: at(18) }),
    ]);
    expect(assignSplits([family], bounds)[0]).toMatchObject({
      split: "development",
      excluded: "boundary_family",
    });
  });

  it("excludes later families that reuse a template already seen in an earlier split", () => {
    const fams = buildFamilies([
      msg({ sentAt: at(15), text: "VENDO 2 pista onix R$ 250" }),
      msg({ sentAt: at(23), text: "vendo 2 pista ONIX R$ 300!" }),
    ]);
    const [first, second] = assignSplits(fams, bounds);
    expect(first.excluded).toBeNull();
    expect(second).toMatchObject({ split: "test", excluded: "template_leak" });
  });
});
