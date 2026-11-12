import { describe, expect, it } from "vitest";
import {
  clusterSuggestions,
  highlight,
  suggestionFrom,
  type ProposalRow,
  type Suggestion,
} from "@/features/inbox/suggestions";

const upcoming = new Map([
  ["p-rodeio", "Rodeio Jaguariúna"],
  ["p-villa", "Villa Mix"],
  ["p-xou", "Xou da Xuxa"],
]);

function row(
  decision: ProposalRow["decision"],
  extra: Partial<Omit<ProposalRow, "observation">> & {
    observation?: Partial<ProposalRow["observation"]>;
  } = {},
): ProposalRow {
  return {
    decision,
    partyId: null,
    candidates: [],
    reason: null,
    ...extra,
    observation: {
      position: 0,
      eventMention: null,
      eventYear: null,
      eventMonth: null,
      eventDay: null,
      spans: [],
      ...extra.observation,
    },
  };
}

const span = { start: 6, end: 12, text: "rodeio" };

describe("suggestionFrom", () => {
  it("links when every informative proposal points at one upcoming festa", () => {
    const suggestion = suggestionFrom(
      [
        row("link", { partyId: "p-rodeio", observation: { spans: [span] } }),
        row("link", { partyId: "p-rodeio", observation: { position: 1 } }),
        row("not_mentioned", { observation: { position: 2 } }),
      ],
      upcoming,
      "run-1",
    );
    expect(suggestion).toEqual({
      kind: "link",
      runId: "run-1",
      party: { id: "p-rodeio", name: "Rodeio Jaguariúna" },
      spans: [span],
    });
  });

  it("suggests nothing when no observation names a festa", () => {
    expect(suggestionFrom([row("not_mentioned")], upcoming, "run-1")).toBeNull();
    expect(suggestionFrom([], upcoming, "run-1")).toBeNull();
  });

  it("drops a festa that is no longer upcoming instead of offering it", () => {
    expect(
      suggestionFrom([row("link", { partyId: "p-merged" })], upcoming, "run-1"),
    ).toBeNull();
    expect(
      suggestionFrom(
        [row("link", { partyId: "p-merged" }), row("link", { partyId: "p-villa" })],
        upcoming,
        "run-1",
      ),
    ).toMatchObject({ kind: "link", party: { id: "p-villa" } });
  });

  it("prefills a new festa with the mention and the date only when fully read", () => {
    expect(
      suggestionFrom(
        [
          row("new_event", {
            observation: {
              eventMention: " Festa do Peão ",
              eventYear: 2026,
              eventMonth: 12,
              eventDay: 5,
            },
          }),
        ],
        upcoming,
        "run-1",
      ),
    ).toMatchObject({
      kind: "new_event",
      name: "Festa do Peão",
      eventAtLocal: "2026-12-05T00:00",
    });
    expect(
      suggestionFrom(
        [
          row("new_event", {
            observation: { eventMention: "Festa do Peão", eventMonth: 12, eventDay: 5 },
          }),
        ],
        upcoming,
        "run-1",
      ),
    ).toMatchObject({ eventAtLocal: null });
  });

  it("asks the operator when the resolver abstained, offering the upcoming shortlist", () => {
    const suggestion = suggestionFrom(
      [
        row("abstain", {
          reason: "sábado ou domingo?",
          candidates: [
            { partyId: "p-rodeio", score: 6 },
            { partyId: "p-merged", score: 5 },
            { partyId: "p-villa", score: 4 },
            { partyId: "p-xou", score: 3 },
            { partyId: "p-tardezinha", score: 2 },
          ],
        }),
      ],
      new Map([...upcoming, ["p-tardezinha", "Tardezinha"]]),
      "run-1",
    );
    expect(suggestion).toMatchObject({
      kind: "doubt",
      options: [
        { id: "p-rodeio", name: "Rodeio Jaguariúna" },
        { id: "p-villa", name: "Villa Mix" },
        { id: "p-xou", name: "Xou da Xuxa" },
      ],
      reasons: ["sábado ou domingo?"],
    });
  });

  it("asks when one message points at two festas, or at a festa and a new one", () => {
    expect(
      suggestionFrom(
        [
          row("link", { partyId: "p-rodeio" }),
          row("link", { partyId: "p-villa", observation: { position: 1 } }),
        ],
        upcoming,
        "run-1",
      ),
    ).toMatchObject({
      kind: "doubt",
      options: [{ id: "p-rodeio" }, { id: "p-villa" }],
    });
    expect(
      suggestionFrom(
        [
          row("link", { partyId: "p-rodeio" }),
          row("new_event", { observation: { position: 1 } }),
        ],
        upcoming,
        "run-1",
      ),
    ).toMatchObject({ kind: "doubt", options: [{ id: "p-rodeio" }] });
  });
});

describe("clusterSuggestions", () => {
  const link = (id: string, name: string): Suggestion => ({
    kind: "link",
    runId: "r",
    party: { id, name },
    spans: [],
  });

  it("groups links by festa, heaviest reach first, and leaves the rest out", () => {
    const clusters = clusterSuggestions([
      { id: "m1", groupReach: 1, suggestion: link("p-villa", "Villa Mix") },
      { id: "m2", groupReach: 1, suggestion: link("p-rodeio", "Rodeio Jaguariúna") },
      { id: "m3", groupReach: 3, suggestion: link("p-rodeio", "Rodeio Jaguariúna") },
      { id: "m4", groupReach: 2, suggestion: link("p-villa", "Villa Mix") },
      { id: "m5", groupReach: 9, suggestion: null },
      {
        id: "m6",
        groupReach: 9,
        suggestion: { kind: "doubt", runId: "r", options: [], reasons: [], spans: [] },
      },
    ]);
    expect(clusters).toEqual([
      {
        party: { id: "p-rodeio", name: "Rodeio Jaguariúna" },
        memberIds: ["m2", "m3"],
        weight: 4,
      },
      {
        party: { id: "p-villa", name: "Villa Mix" },
        memberIds: ["m1", "m4"],
        weight: 3,
      },
    ]);
  });
});

describe("highlight", () => {
  const text = "vendo rodeio sábado pista";

  it("marks the quoted evidence and merges overlapping spans", () => {
    expect(
      highlight(text, [
        { start: 13, end: 19, text: "sábado" },
        { start: 6, end: 12, text: "rodeio" },
        { start: 9, end: 19, text: "eio sábado" },
      ]),
    ).toEqual([
      { text: "vendo ", mark: false },
      { text: "rodeio sábado", mark: true },
      { text: " pista", mark: false },
    ]);
  });

  it("skips spans whose offsets do not quote the text", () => {
    expect(
      highlight(text, [
        { start: 0, end: 5, text: "compro" },
        { start: 20, end: 99, text: "pista" },
      ]),
    ).toEqual([{ text, mark: false }]);
  });
});
