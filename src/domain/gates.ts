import { daysUntil } from "@/domain/timezone";
import type { PartyStatus } from "@/domain/match";

export function canAppearOnWatchlist(input: {
  status: PartyStatus;
  hasOpenLot: boolean;
}): boolean {
  return input.status === "upcoming" && input.hasOpenLot;
}

export function canRankOnHeat(status: PartyStatus): boolean {
  return status === "upcoming";
}

export function isPastEvent(eventAt: Date, now: Date): boolean {
  return daysUntil(eventAt, now) < 0;
}
