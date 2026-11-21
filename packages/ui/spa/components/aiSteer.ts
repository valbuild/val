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
 * - `rejected`: not taken now -- most often because enough is waiting
 *   already. It goes into the queue, in order, like `too_late`, and the chat
 *   says why. Sending it again into the same turn would only fail again, and
 *   the queue is where it can still be edited or removed.
 *
 * And three things the server does not say:
 *
 * - No answer at all within `STEER_ACK_TIMEOUT_MS`: a server that predates
 *   steering ignores `ai_steer`, so the message is queued exactly as it was
 *   before steering existed. It keeps its `steerId`, so a late `accepted`
 *   takes it back out of the queue rather than sending it twice.
 * - The turn ended (an answer, an error, Stop) with a steer still waiting:
 *   there is no next step to read it at, so it goes into the queue as
 *   `too_late` would put it. After a Stop the queue waits for the person, as
 *   it always has.
 * - The person opened another chat. A steer belongs to the chat it was sent
 *   in, and is never sent into another one: it is left to its own turn, which
 *   delivers it or ends without it. One that ends up unread is `stranded` --
 *   kept for the person, with Edit and Remove, and sent nowhere by itself.
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

/** The chat a message was written in; `null` for one not yet started. */
export type ChatSessionId = string | null;

/** What the queue and the steers hold: a message, in the order written. */
export type OutgoingMessage = {
  id: string;
  /** When it was written, relative to every other message: queue order. */
  seq: number;
  /**
   * Set once it has been steered, so a late status can still find it, with
   * the chat it was steered into: it is never sent into another one.
   */
  steered?: { steerId: string; sessionId: ChatSessionId };
};

export type SteerState =
  /** Sent; the server has not said anything about it yet. */
  | "sending"
  /** The server has it for the running turn. It cannot be taken back. */
  | "accepted"
  /**
   * Sent into a chat the person has left, and not read there: kept for them
   * to edit or remove, and never sent by itself.
   */
  | "stranded";

export type Steer<M extends OutgoingMessage> = {
  steerId: string;
  /** The chat whose running turn it was sent into. */
  sessionId: ChatSessionId;
  message: M;
  state: SteerState;
  /** For `STEER_ACK_TIMEOUT_MS`. */
  sentAt: number;
};

export type Outbox<M extends OutgoingMessage> = {
  /** Waiting for a turn to end: sent one per turn, in order. */
  queue: M[];
  /** Sent into a running turn, and not delivered yet. */
  steers: Steer<M>[];
};

export type SteerEffect<M extends OutgoingMessage> =
  | { type: "none" }
  /** Show it as a user message, where the turn has got to. */
  | { type: "delivered"; message: M }
  /** It was queued instead; say why. */
  | { type: "rejected"; reason: string };

export type SteerResult<M extends OutgoingMessage> = {
  outbox: Outbox<M>;
  effect: SteerEffect<M>;
};

export function emptyOutbox<M extends OutgoingMessage>(): Outbox<M> {
  return { queue: [], steers: [] };
}

/** It was sent into the running turn of `sessionId`. */
export function steerSent<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  message: M,
  steerId: string,
  sessionId: ChatSessionId,
  now: number,
): Outbox<M> {
  return {
    ...outbox,
    steers: [
      ...outbox.steers,
      {
        steerId,
        sessionId,
        message: { ...message, steered: { steerId, sessionId } },
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

/**
 * A steer that will not be read in its turn: into the queue when its chat is
 * the one open, stranded when it is not.
 */
function unread<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  steer: Steer<M>,
  shown: ChatSessionId,
): Outbox<M> {
  const others = outbox.steers.filter((s) => s.steerId !== steer.steerId);
  if (steer.sessionId === shown) {
    return {
      queue: enqueueInOrder(outbox.queue, steer.message),
      steers: others,
    };
  }
  return { ...outbox, steers: [...others, { ...steer, state: "stranded" }] };
}

/**
 * What the server said about a steer. Unknown ids change nothing. `shown` is
 * the chat on screen: a steer of another chat is never shown here, nor sent.
 */
export function applySteerStatus<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  steerId: string,
  status: AISteerStatus,
  reason: string | undefined,
  shown: ChatSessionId,
): SteerResult<M> {
  const none: SteerResult<M> = { outbox, effect: { type: "none" } };
  const steer = outbox.steers.find((s) => s.steerId === steerId);
  const withoutSteer = outbox.steers.filter((s) => s.steerId !== steerId);
  if (steer !== undefined) {
    if (steer.state === "stranded") {
      // Read in its own chat after all: nothing left for the person to do.
      return status === "delivered"
        ? { outbox: { ...outbox, steers: withoutSteer }, effect: none.effect }
        : none;
    }
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
          effect:
            steer.sessionId === shown
              ? { type: "delivered", message: steer.message }
              : { type: "none" },
        };
      case "too_late":
        return { outbox: unread(outbox, steer, shown), effect: none.effect };
      case "rejected":
        return {
          outbox: unread(outbox, steer, shown),
          effect:
            steer.sessionId === shown
              ? {
                  type: "rejected",
                  reason: reason ?? "The assistant could not take it now.",
                }
              : { type: "none" },
        };
    }
  }
  // Not waiting as a steer: it fell back to the queue (no answer in time, or
  // its turn ended first). Still unsent there, so the server's word decides.
  const queued = outbox.queue.find((m) => m.steered?.steerId === steerId);
  if (queued === undefined || queued.steered === undefined) return none;
  const withoutQueued = outbox.queue.filter(
    (m) => m.steered?.steerId !== steerId,
  );
  switch (status) {
    case "accepted":
      // The server has it after all: it must not be sent again as a prompt.
      return {
        outbox: {
          queue: withoutQueued,
          steers: [
            ...outbox.steers,
            {
              steerId,
              sessionId: queued.steered.sessionId,
              message: queued,
              state: "accepted",
              sentAt: 0,
            },
          ],
        },
        effect: { type: "none" },
      };
    case "delivered":
      return {
        outbox: { ...outbox, queue: withoutQueued },
        effect:
          queued.steered.sessionId === shown
            ? { type: "delivered", message: queued }
            : { type: "none" },
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
  shown: ChatSessionId,
): Outbox<M> {
  const steer = outbox.steers.find((s) => s.steerId === steerId);
  if (steer === undefined || steer.state !== "sending") return outbox;
  return unread(outbox, steer, shown);
}

/**
 * The turn of the chat on screen is over: nothing waiting for its next step
 * will be read in it. Another chat's steers are left to that chat's turn.
 */
export function steersTurnEnded<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  shown: ChatSessionId,
): Outbox<M> {
  const waiting = outbox.steers.filter(
    (s) => s.sessionId === shown && isWaitingSteer(s),
  );
  if (waiting.length === 0) return outbox;
  return waiting.reduce((next, steer) => unread(next, steer, shown), outbox);
}

/**
 * Another chat is on screen now. A steer that fell back to the queue belongs
 * to the chat it was steered into, so it is taken out of the queue -- the
 * queue sends into whichever chat is open -- and kept for the person.
 */
export function leftChat<M extends OutgoingMessage>(
  outbox: Outbox<M>,
  shown: ChatSessionId,
): Outbox<M> {
  const elsewhere = outbox.queue.filter(
    (m) => m.steered !== undefined && m.steered.sessionId !== shown,
  );
  if (elsewhere.length === 0) return outbox;
  return {
    queue: outbox.queue.filter((m) => !elsewhere.includes(m)),
    steers: [
      ...outbox.steers,
      ...elsewhere.flatMap((message): Steer<M>[] =>
        message.steered === undefined
          ? []
          : [
              {
                steerId: message.steered.steerId,
                sessionId: message.steered.sessionId,
                message,
                state: "stranded",
                sentAt: 0,
              },
            ],
      ),
    ],
  };
}

/** Whether a steer is still waiting on its running turn. */
export function isWaitingSteer<M extends OutgoingMessage>(
  steer: Steer<M>,
): boolean {
  return steer.state === "sending" || steer.state === "accepted";
}

/** The steer that falls back first, if any is still unanswered. */
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
