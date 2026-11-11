import { describe, expect, it } from "vitest";
import type { InterpretationRequest } from "@/pipeline/interpreter";
import { rulesInterpreter } from "@/pipeline/interpreters/rules";
import { validateInterpretation } from "@/pipeline/observation";

const sentAt = new Date("2026-09-16T15:00:00Z");
const catalog: InterpretationRequest["catalog"] = [
  {
    id: "p1",
    name: "Festa Junina",
    aliases: ["junina"],
    status: "upcoming",
    eventAt: new Date("2026-10-17T23:00:00Z"),
  },
];

async function read(
  text: string,
  senderRole: InterpretationRequest["senderRole"] = "unknown",
) {
  const { output } = await rulesInterpreter.interpret(
    { text, sentAt, senderRole, context: [], catalog },
    new AbortController().signal,
  );
  const checked = validateInterpretation(output, { text, context: [] });
  expect(checked.errors).toEqual([]);
  return checked.observations!;
}

const BLAST = [
  "🌊 *RÉVEILLON AREIA BÚZIOS* 🌊",
  "_27.12 a 02.01_",
  "🎟️ Garanta com *DESCONTO* abaixo: https://tinyurl.com/Areia2027",
  "🪩 31.12 • *RÉVEILLON SAL* 🪩",
  "🍹🍝 All Inclusive R$ 450",
  "🎟️ Garanta: https://www.sympla.com.br/evento/reveillon-sal/3543836",
].join("\n");

describe("rulesInterpreter", () => {
  it("reads a person's ticket post as an offer for the festa it names", async () => {
    const [observation, ...rest] = await read("  vendo 1 pista da junina  ");
    expect(rest).toEqual([]);
    expect(observation).toMatchObject({
      intent: "offer",
      eventMention: "Festa Junina",
    });
    expect(observation.spans).toEqual([
      { start: 2, end: 25, text: "vendo 1 pista da junina" },
    ]);
  });

  it("reads small talk as unrelated, with nothing to cite", async () => {
    expect(await read("bom dia galera")).toEqual([
      expect.objectContaining({ intent: "unrelated", spans: [] }),
    ]);
  });

  it("gives each festa of a season blast its own observation, citing its own block", async () => {
    const observations = await read(BLAST, "admin");
    expect(observations.map((o) => o.eventMention)).toEqual([
      "RÉVEILLON AREIA BÚZIOS",
      "RÉVEILLON SAL",
    ]);
    expect(observations[1].spans[0].text).toMatch(/^🪩 31\.12/);
    expect(observations[1].price).toEqual({
      amount: 450,
      currency: "BRL",
      meaning: "official",
    });
  });

  it("does not claim a year the message never wrote", async () => {
    const [areia] = await read(BLAST, "admin");
    expect(areia.eventDate).toEqual({
      year: null,
      month: 12,
      day: 27,
      basis: "explicit",
    });
  });
});
