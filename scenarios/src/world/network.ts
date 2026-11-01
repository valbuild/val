/**
 * The network between the Studio, the page and Val's server: the only part of
 * the world that is not the product's own code (with the clock, and the
 * framework's request context). It delivers every request to the app's real
 * route handler, records it, and can hold requests that match a rule until the
 * test releases them.
 */

export type Exchange = {
  /** Who sent it: "studio:editor", "page:/" … */
  from: string;
  method: string;
  path: string;
  /** The answer's status, or where the request is. */
  status: number | "in-flight" | "held";
};

export type HoldRule = { method?: string; path: string };

export type Network = {
  /** A `fetch` for one sender, in the shape `createValClient` takes. */
  fetchFor(
    from: string,
  ): (input: string, init: RequestInit) => Promise<Response>;
  /** Hold every request matching `rule` until {@link release}. */
  hold(rule: HoldRule): void;
  /** Let held requests through, and stop holding. */
  release(): void;
  /** Every request so far, in the order they were sent. */
  readonly log: readonly Exchange[];
  /** Resolves when no request is in flight or held. */
  idle(): Promise<void>;
};

const ORIGIN = "http://localhost";

export function createNetwork(
  handler: (request: Request) => Promise<Response>,
): Network {
  const log: Exchange[] = [];
  const holds: HoldRule[] = [];
  let waiting: Array<() => void> = [];
  let inFlight = 0;
  let idleWaiters: Array<() => void> = [];

  const settleIdle = () => {
    if (inFlight === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  };

  const matches = (rule: HoldRule, method: string, path: string) =>
    (rule.method === undefined || rule.method === method) &&
    path.startsWith(rule.path);

  return {
    fetchFor(from) {
      return async (input, init) => {
        const url = new URL(input, ORIGIN);
        const method = (init.method ?? "GET").toUpperCase();
        const exchange: Exchange = {
          from,
          method,
          path: url.pathname,
          status: "in-flight",
        };
        log.push(exchange);
        inFlight++;
        try {
          if (holds.some((rule) => matches(rule, method, url.pathname))) {
            exchange.status = "held";
            await new Promise<void>((resolve) => waiting.push(resolve));
            exchange.status = "in-flight";
          }
          const response = await handler(new Request(url.href, init));
          exchange.status = response.status;
          return response;
        } finally {
          inFlight--;
          settleIdle();
        }
      };
    },
    hold(rule) {
      holds.push(rule);
    },
    release() {
      holds.length = 0;
      const released = waiting;
      waiting = [];
      released.forEach((resolve) => resolve());
    },
    get log() {
      return log;
    },
    idle() {
      if (inFlight === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
