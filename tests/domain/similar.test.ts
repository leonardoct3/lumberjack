import { describe, expect, it } from "vitest";
import { findSimilarParties, nameAffinity } from "@/domain/similar";

const eventAt = new Date("2026-10-24T23:00:00Z");

function party(name: string, aliases: string[] = []) {
  return { id: name, name, aliases, eventAt };
}

describe("nameAffinity", () => {
  it("scores an exact name highest, ignoring case and accents", () => {
    expect(nameAffinity("Rodeio Jaguariúna", "rodeio jaguariuna")).toBe(3);
  });

  it("scores containment above a plain token overlap", () => {
    expect(nameAffinity("ONIX Festival", "ONIX")).toBe(2);
  });

  it("scores names that share the shorter name's tokens", () => {
    expect(nameAffinity("Rodeio de Jaguariúna", "Jaguariúna Rodeio")).toBe(1);
  });

  it("does not flag two different parties of the same season", () => {
    expect(nameAffinity("Réveillon Sal", "Réveillon Areia Búzios")).toBe(0);
    expect(nameAffinity("Réveillon 2027", "Réveillon 2026")).toBe(0);
  });

  it("does not flag unrelated names", () => {
    expect(nameAffinity("Tomorrowland Brasil", "Lollapalooza 2027")).toBe(0);
  });

  it("ignores an empty side", () => {
    expect(nameAffinity("", "Rodeio")).toBe(0);
    expect(nameAffinity("Rodeio", "   ")).toBe(0);
  });
});

describe("findSimilarParties", () => {
  it("returns the strongest match first", () => {
    const matches = findSimilarParties("Baile da Favorita", [
      party("Favorita"),
      party("Baile da Favorita"),
      party("Tomorrowland Brasil"),
    ]);

    expect(matches.map((m) => m.name)).toEqual(["Baile da Favorita", "Favorita"]);
  });

  it("matches through an alias, not only the name", () => {
    const matches = findSimilarParties("Superbull", [
      party("Rodeio de Jaguariúna", ["superbull"]),
    ]);

    expect(matches.map((m) => m.name)).toEqual(["Rodeio de Jaguariúna"]);
  });

  it("skips the party being edited", () => {
    const self = party("Baile da Favorita");

    const matches = findSimilarParties("Baile da Favorita", [self], {
      excludeId: self.id,
    });

    expect(matches).toEqual([]);
  });

  it("returns nothing when no name is close", () => {
    expect(findSimilarParties("Chá da Alice", [party("Rodeio")])).toEqual([]);
  });
});
