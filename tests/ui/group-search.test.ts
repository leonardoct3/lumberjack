import { describe, expect, it } from "vitest";
import { duplicateNames, searchGroups, shortWaId } from "@/lib/group-search";

const groups = [
  { id: "1", name: "Ingressos Carnaval São Paulo" },
  { id: "2", name: "REVENDA · Baile do Dennis" },
  { id: "3", name: "Baile da Gaiola — vendas" },
  { id: "4", name: "Promos Rio de Janeiro" },
];

describe("searchGroups", () => {
  it("returns nothing while the query is empty", () => {
    expect(searchGroups(groups, "")).toEqual({ matches: [], total: 0 });
    expect(searchGroups(groups, "   ")).toEqual({ matches: [], total: 0 });
  });

  it("matches case-insensitively", () => {
    const { matches } = searchGroups(groups, "GAIOLA");
    expect(matches.map((g) => g.id)).toEqual(["3"]);
  });

  it("ignores accents on both sides", () => {
    expect(searchGroups(groups, "sao paulo").matches.map((g) => g.id)).toEqual([
      "1",
    ]);
    expect(searchGroups(groups, "cárnaval").matches.map((g) => g.id)).toEqual([
      "1",
    ]);
  });

  it("requires every term to appear, in any order", () => {
    expect(searchGroups(groups, "baile vendas").matches.map((g) => g.id)).toEqual(
      ["3"],
    );
    expect(searchGroups(groups, "vendas baile").matches.map((g) => g.id)).toEqual(
      ["3"],
    );
    expect(searchGroups(groups, "baile promos").matches).toEqual([]);
  });

  it("keeps the input order of the matches", () => {
    expect(searchGroups(groups, "baile").matches.map((g) => g.id)).toEqual([
      "2",
      "3",
    ]);
  });

  it("caps the matches and reports the full count", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      name: `Grupo ${i}`,
    }));
    const { matches, total } = searchGroups(many, "grupo", 10);
    expect(matches).toHaveLength(10);
    expect(total).toBe(40);
  });
});

describe("duplicateNames", () => {
  it("collects only the names shared by more than one group", () => {
    const dupes = duplicateNames([
      { id: "1", name: "SÃO PAULO - VIPS" },
      { id: "2", name: "SÃO PAULO - VIPS" },
      { id: "3", name: "SÃO PAULO - VIPS" },
      { id: "4", name: "Baile da Gaiola" },
    ]);
    expect([...dupes]).toEqual(["SÃO PAULO - VIPS"]);
  });

  it("is empty when every name is unique", () => {
    expect(duplicateNames(groups).size).toBe(0);
  });
});

describe("shortWaId", () => {
  it("keeps the last four digits of the group jid", () => {
    expect(shortWaId("120363260217413903@g.us")).toBe("3903");
    expect(shortWaId("120363047766212468@g.us")).toBe("2468");
  });

  it("tolerates ids without a domain", () => {
    expect(shortWaId("42")).toBe("42");
  });
});
