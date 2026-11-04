import type { FailureKind, PartyStatus, SenderRole } from "@prisma/client";

/** Everything an interpreter may read. Both halves are hashed, so a cached run is only reused for the same reading. */
export type InterpretationRequest = {
  text: string;
  sentAt: Date;
  senderRole: SenderRole;
  catalog: CatalogEntry[];
};

export type CatalogEntry = {
  id: string;
  name: string;
  aliases: string[];
  status: PartyStatus;
};

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

/** `output` is untrusted until `validateInterpretation` has checked it against the message. */
export type InterpreterResult = { output: unknown; usage?: Usage };

export interface Interpreter {
  name: string;
  version: string;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  /** Paid interpreters run only within the daily budget. */
  paid: boolean;
  interpret(
    request: InterpretationRequest,
    signal: AbortSignal,
  ): Promise<InterpreterResult>;
}

/** How an adapter says what went wrong, which decides whether the job is retried. */
export class InterpreterError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly usage?: Usage,
  ) {
    super(message);
  }
}
