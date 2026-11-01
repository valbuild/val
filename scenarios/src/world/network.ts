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
  /** Which handler answered, by the name it was given ({@link Network.name}). */
  to?: string;
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
  /**
   * Send new requests to another handler: what happens when HMR re-evaluates
   * the app's server module. A request already in flight finishes on the
   * handler it reached, as it does in a dev server.
   */
  route(handler: (request: Request) => Promise<Response>): void;
  /**
   * Choose a handler per request, as a rollout does: two builds answer for a
   * while, and which one a request reaches depends on where it lands. `pick`
   * answering `null` sends the request to the current handler ({@link route}).
   */
  routeBy(pick: ((request: RouteRequest) => Handler | null) | null): void;
  /** Name a handler, so the log says which one answered (`Exchange.to`). */
  name(handler: Handler, name: string): void;
};

export type Handler = (request: Request) => Promise<Response>;
export type RouteRequest = { from: string; method: string; path: string };

const ORIGIN = "http://localhost";

export function createNetwork(
  initialHandler: (request: Request) => Promise<Response>,
): Network {
  let handler = initialHandler;
  let pick: ((request: RouteRequest) => Handler | null) | null = null;
  const names = new WeakMap<Handler, string>();
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
          const target =
            pick?.({ from, method, path: url.pathname }) ?? handler;
          exchange.to = names.get(target);
          const response = await target(new Request(url.href, init));
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
    route(next) {
      handler = next;
    },
    routeBy(next) {
      pick = next;
    },
    name(target, name) {
      names.set(target, name);
    },
  };
}
