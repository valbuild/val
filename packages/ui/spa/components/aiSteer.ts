import type { AISteerStatus } from "../hooks/useAIWebSocket";

/**
 * Steering: a message the person sends while their own turn runs goes to the
 * server at once (`ai_steer`), and the agent reads it at its next step. What
 * the server says about it (`ai_steer_status`) moves it on:
 *
 * - `accepted`: it waits for the next step. It cannot be taken back now.
 * - `delivered`: the agent has it. It is a user message from here on, shown
 *   where it was delivered, between the assistant's steps.
 * - `too_late`: the turn ended without another step. It goes into the queue,
 *   in the order it was written, and is sent as the next prompt.
 * - `rejected`: it stays with the person, with the reason, to edit.
 *
 * And two things the server does not say:
 *
 * - No answer at all within `STEER_ACK_TIMEOUT_MS`: a server that predates
 *   steering ignores `ai_steer`, so the message is queued exactly as it was
 *   before steering existed. It keeps its `steerId`, so a late `accepted`
 *   takes it back out of the queue rather than sending it twice.
 * - The turn ended (an answer, an error, Stop) with a steer still waiting:
 *   there is no next step to read it at, so it goes into the queue as
 *   `too_late` would put it. After a Stop the queue waits for the person, as
 *   it always has.
 *
 * Pure, so the chat and its tests run the same transitions. The chat keeps
 * the state and performs the `effect`.
 */

/**
 * How long a steered message waits for the server's first word on it before
 * it is queued instead. Long enough for a slow connection; short enough that
 * someone whose server cannot steer is not left wondering.
 */
export const STEER_ACK_TIMEOUT_MS = 5000;

/** What the queue and the steers hold: a message, in the order written. */
export type OutgoingMessage = {
  id: string;
  /** When it was written, relative to every other message: queue order. */
  seq: number;
  /** Set once it has been steered, so a late status can still find it. */
  steerId?: string;
};

export type SteerState =
  /** Sent; the server has not said anything about it yet. */
  | "sending"
  /** The server has it for the running turn. It cannot be taken back. */
  | "accepted"
  /** The server would not take it. `reason` says why. */
  | "rejected";

export type Steer<M extends OutgoingMessage> = {
  steerId: string;
  message: M;
  state: SteerState;
  reason?: string;
  /** For `STEER_ACK_TIMEOUT_MS`. */
  sentAt: number;
};

export type Outbox<M extends OutgoingMessage> = {
  /** Waiting for a turn to end: sent one per turn, in order. */
  queue: M[];
  /** Sent into the running turn, and not delivered yet. */
  steers: Steer<M>[];
};

export type SteerEffect<M extends OutgoingMessage> =
  | { type: "none" }
  /** Show it as a user message, where the turn has got to. */
  | { type: "delivered"; message: M }
  /** Give it back to the person, with why. */
  | { type: "rejected"; steerId: string; message: M; reason: string };

export function emptyOutbox<M extends OutgoingMessage>(): Outbox<M> {
  return { queue: [], steers: [] };
}

/** It was sent into the running turn. */
export function steerSent<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  message: M,
  steerId: string,
  now: number,
): Outbox<M> {
  return {
    ...outbox,
    steers: [
      ...outbox.steers,
      {
        steerId,
        message: { ...message, steerId },
        state: "sending",
        sentAt: now,
      },
    ],
  };
}

/**
 * Into the queue where it was written: before the first message written
 * after it. A message the person moved up stays where they put it.
 */
export function enqueueInOrder<M extends OutgoingMessage>(
  queue: M[],
  message: M,
): M[] {
  const at = queue.findIndex((queued) => queued.seq > message.seq);
  return at === -1
    ? [...queue, message]
    : [...queue.slice(0, at), message, ...queue.slice(at)];
}

export type SteerResult<M extends OutgoingMessage> = {
  outbox: Outbox<M>;
  effect: SteerEffect<M>;
};

/** What the server said about a steer. Unknown ids change nothing. */
export function applySteerStatus<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  steerId: string,
  status: AISteerStatus,
  reason: string | undefined,
): SteerResult<M> {
  const none: SteerResult<M> = { outbox, effect: { type: "none" } };
  const steer = outbox.steers.find((s) => s.steerId === steerId);
  const withoutSteer = outbox.steers.filter((s) => s.steerId !== steerId);
  if (steer !== undefined) {
    switch (status) {
      case "accepted":
        if (steer.state !== "sending") return none;
        return {
          outbox: {
            ...outbox,
            steers: outbox.steers.map((s) =>
              s.steerId === steerId ? { ...s, state: "accepted" } : s,
            ),
          },
          effect: { type: "none" },
        };
      case "delivered":
        return {
          outbox: { ...outbox, steers: withoutSteer },
          effect: { type: "delivered", message: steer.message },
        };
      case "too_late":
        if (steer.state === "rejected") return none;
        return {
          outbox: {
            queue: enqueueInOrder(outbox.queue, steer.message),
            steers: withoutSteer,
          },
          effect: { type: "none" },
        };
      case "rejected": {
        if (steer.state === "rejected") return none;
        const why = reason ?? "The assistant could not take this message.";
        return {
          outbox: {
            ...outbox,
            steers: outbox.steers.map((s) =>
              s.steerId === steerId
                ? { ...s, state: "rejected", reason: why }
                : s,
            ),
          },
          effect: {
            type: "rejected",
            steerId,
            message: steer.message,
            reason: why,
          },
        };
      }
    }
  }
  // Not waiting as a steer: it fell back to the queue (no answer in time, or
  // its turn ended first). Still unsent there, so the server's word decides.
  const queued = outbox.queue.find((m) => m.steerId === steerId);
  if (queued === undefined) return none;
  const withoutQueued = outbox.queue.filter((m) => m.steerId !== steerId);
  switch (status) {
    case "accepted":
      // The server has it after all: it must not be sent again as a prompt.
      return {
        outbox: {
          queue: withoutQueued,
          steers: [
            ...outbox.steers,
            { steerId, message: queued, state: "accepted", sentAt: 0 },
          ],
        },
        effect: { type: "none" },
      };
    case "delivered":
      return {
        outbox: { ...outbox, queue: withoutQueued },
        effect: { type: "delivered", message: queued },
      };
    case "too_late":
    case "rejected":
      // Queued already, and sent as a prompt when its turn comes.
      return none;
  }
}

/** No word from the server in time: queue it, as before steering existed. */
export function steerTimedOut<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  steerId: string,
): Outbox<M> {
  const steer = outbox.steers.find((s) => s.steerId === steerId);
  if (steer === undefined || steer.state !== "sending") return outbox;
  return {
    queue: enqueueInOrder(outbox.queue, steer.message),
    steers: outbox.steers.filter((s) => s.steerId !== steerId),
  };
}

/**
 * The turn is over: nothing waiting for its next step will be read in it.
 * Rejected ones stay, for the person.
 */
export function steersTurnEnded<M extends OutgoingMessage>(
  outbox: Outbox<M>,
): Outbox<M> {
  const waiting = outbox.steers.filter((s) => s.state !== "rejected");
  if (waiting.length === 0) return outbox;
  return {
    queue: waiting.reduce(
      (queue, steer) => enqueueInOrder(queue, steer.message),
      outbox.queue,
    ),
    steers: outbox.steers.filter((s) => s.state === "rejected"),
  };
}

/** Whether a steer is still waiting on the running turn. */
export function isWaitingSteer<M extends OutgoingMessage>(
  steer: Steer<M>,
): boolean {
  return steer.state !== "rejected";
}

/** The steer that falls back to the queue first, if any is still unanswered. */
export function nextSteerDeadline<M extends OutgoingMessage>(
  outbox: Outbox<M>,
): { steerId: string; at: number } | null {
  let next: { steerId: string; at: number } | null = null;
  for (const steer of outbox.steers) {
    if (steer.state !== "sending") continue;
    const at = steer.sentAt + STEER_ACK_TIMEOUT_MS;
    if (next === null || at < next.at) next = { steerId: steer.steerId, at };
  }
  return next;
}
