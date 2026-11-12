import type {
  Candidate,
  ResolutionObservation,
  ResolutionRequest,
  ResolvedObservation,
  Resolver,
} from "../resolution";

/** A name at least contained in the other, which is how the current matcher links. */
const STRONG = 2;

/**
 * Links only when one edition answers to the name and nothing written
 * contradicts it. Several editions under one name that the date does not
 * separate are an abstention, never a guess.
 */
export function decideByRules(
  observation: ResolutionObservation,
  shortlist: Candidate[],
): Omit<ResolvedObservation, "observation"> {
  if (observation.intent === "unrelated")
    return { decision: "not_mentioned", partyId: null, reason: "unrelated" };
  const mentioned = Boolean(observation.eventMention?.trim());
  if (shortlist.length === 0)
    return mentioned
      ? {
          decision: "new_event",
          partyId: null,
          reason: "no catalogued edition answers to the name",
        }
      : { decision: "not_mentioned", partyId: null, reason: "no event named" };

  const named = shortlist.filter((c) => c.nameMatch >= STRONG);
  const fitting = named.filter((c) => c.dateFit >= 0);
  if (named.length > 0 && fitting.length === 0)
    return mentioned
      ? {
          decision: "new_event",
          partyId: null,
          reason: "the written date fits no edition of that name",
        }
      : {
          decision: "abstain",
          partyId: null,
          reason: "the written date fits no named edition",
        };
  if (fitting.length === 1)
    return {
      decision: "link",
      partyId: fitting[0].partyId,
      reason: fitting[0].reasons.join(" "),
    };
  if (fitting.length > 1) {
    const [first, second] = fitting;
    if (first.dateFit > second.dateFit)
      return {
        decision: "link",
        partyId: first.partyId,
        reason: first.reasons.join(" "),
      };
    return {
      decision: "abstain",
      partyId: null,
      reason: `${fitting.length} editions answer to the name and the date does not separate them`,
    };
  }
  return { decision: "abstain", partyId: null, reason: "only loose name matches" };
}

export function resolveByRules(request: ResolutionRequest): ResolvedObservation[] {
  return request.observations.map((o, i) => ({
    observation: i,
    ...decideByRules(o, request.shortlists[i]),
  }));
}

export const rulesResolver: Resolver = {
  name: "rules",
  version: "1",
  provider: null,
  model: null,
  promptVersion: null,
  paid: false,
  async resolve(request) {
    return { output: { resolutions: resolveByRules(request) } };
  },
};
