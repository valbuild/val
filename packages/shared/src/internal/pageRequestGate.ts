/**
 * What stops `interact_page` from sending anything to the site's server
 * without the person: the page's own requests, held while an action runs.
 *
 * The preview is the real site, and its backend is real: a submit can send an
 * email, place an order, delete an account. Looking at what was clicked
 * cannot say whether that will happen -- a `<div onclick>` can post, a
 * `<button type=submit>` in a search box does not, a label clicks the button
 * it names -- so this does not look. It watches what the page DOES, from the
 * moment the action is dispatched until the page has settled:
 *
 * - `fetch`, `XMLHttpRequest` and `navigator.sendBeacon` with a method that
 *   sends data (anything but GET, HEAD and OPTIONS) are not sent. The page's
 *   `fetch` gets a promise that has not settled yet; its XHR has not been
 *   sent; its beacon was "queued".
 * - A form submitted with such a method -- natively, caught by a
 *   capture-phase `submit` listener on the window, or by `form.submit()`,
 *   which fires no event and is wrapped -- is not submitted.
 *
 * Those are HELD, not dropped: the person is shown exactly what the page
 * tried (method, the URL the browser resolved), and Allow sends exactly those
 * (`releaseHold`); anything else, or a minute nobody answered in, rejects
 * them as an abort. Holding them rather than re-running the action is what
 * ties the approval to what was shown: a page that re-rendered, or a click
 * the person made in the preview while the card waited, cannot put another
 * request in their place.
 *
 * A request to ANOTHER site that sends data is refused outright, never
 * asked about, and so is a form that would take the frame to another site or
 * into another window: the preview stays on the site.
 *
 * Everything is put back when the action ends (`stop`). Outside an action
 * the page is untouched, and nothing here runs outside the Studio's frame:
 * only the canvas bridge calls it.
 *
 * Not caught: a request made with a reference the page took to the
 * original `fetch` or `XMLHttpRequest.prototype.send` before the action (a
 * library that captured it at load), WebSocket and EventSource messages,
 * and an XHR opened before the action started.
 */

/** The page's window, as `window` is typed: with its own constructors. */
type Win = Window & typeof globalThis;

/** A request the page tried to make during an action. */
export type PageRequest = {
  via: "fetch" | "xhr" | "beacon" | "form";
  /** Upper case: `POST`. */
  method: string;
  /** Absolute, as the browser resolved it. */
  url: string;
};

/** A held request, and how to send or refuse it. */
type Held = PageRequest & { send: () => void; refuse: () => void };

/** The methods that only read: let through. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** How long a hold waits for the person before it is refused. */
export const HOLD_TIMEOUT_MS = 10 * 60_000;

export type RequestGate = {
  /** What was held so far. */
  held: () => readonly PageRequest[];
  /** What was refused for going to another site. */
  blocked: () => readonly PageRequest[];
  /**
   * Put every wrap back. What was held stays held, and is returned: hand it
   * to {@link holdRequests}, or refuse it.
   */
  stop: () => HeldRequests;
};

/** Requests held by a gate that stopped: opaque outside this module. */
export type HeldRequests = { readonly requests: readonly Held[] };

/** Start holding the page's data-sending requests: see the module doc. */
export function startRequestGate(win: Win): RequestGate {
  const held: Held[] = [];
  const blocked: PageRequest[] = [];
  const restores: Array<() => void> = [];
  const origin = win.location.origin;

  /** Let it through, hold it, or refuse it: which was done. */
  const consider = (
    request: PageRequest,
    send: () => void,
    refuse: () => void,
    options: { offSiteReads?: "pass" | "block" } = {},
  ): "sent" | "held" | "blocked" => {
    const sameSite = isSameSite(request.url, origin);
    const reads = READ_METHODS.has(request.method);
    if (reads && (sameSite || options.offSiteReads !== "block")) {
      send();
      return "sent";
    }
    if (!sameSite) {
      blocked.push(request);
      refuse();
      return "blocked";
    }
    held.push({ ...request, send, refuse });
    return "held";
  };

  // --- fetch -----------------------------------------------------------------
  const originalFetch = typeof win.fetch === "function" ? win.fetch : null;
  if (originalFetch !== null) {
    const gatedFetch = function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const request = fetchRequestOf(win, input, init);
      // On the window, whatever it was called on: "Illegal invocation".
      const call = () => originalFetch.call(win, input, init);
      if (request === null || READ_METHODS.has(request.method)) return call();
      return new Promise<Response>((resolve, reject) => {
        consider(
          request,
          () => call().then(resolve, reject),
          () => reject(abortError(win)),
        );
      });
    };
    win.fetch = gatedFetch;
    restores.push(() => {
      if (win.fetch === gatedFetch) win.fetch = originalFetch;
    });
  }

  // --- XMLHttpRequest --------------------------------------------------------
  const xhr = win.XMLHttpRequest?.prototype;
  if (xhr !== undefined) {
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    const opened = new WeakMap<XMLHttpRequest, PageRequest>();
    const gatedOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
      const [method, url] = args;
      const resolved = resolveUrl(win, url);
      if (typeof method === "string" && resolved !== null) {
        opened.set(this, {
          via: "xhr",
          method: method.toUpperCase(),
          url: resolved,
        });
      }
      return Reflect.apply(originalOpen, this, args);
    };
    const gatedSend = function (this: XMLHttpRequest, ...args: unknown[]) {
      const request = opened.get(this);
      const call = () => Reflect.apply(originalSend, this, args);
      if (request === undefined || READ_METHODS.has(request.method)) {
        return call();
      }
      consider(request, call, () => {
        // As a request that failed: what the page listens for.
        this.dispatchEvent(new win.ProgressEvent("error"));
        this.dispatchEvent(new win.ProgressEvent("loadend"));
      });
    };
    xhr.open = gatedOpen;
    xhr.send = gatedSend;
    restores.push(() => {
      if (xhr.open === gatedOpen) xhr.open = originalOpen;
      if (xhr.send === gatedSend) xhr.send = originalSend;
    });
  }

  // --- navigator.sendBeacon --------------------------------------------------
  const navigator = win.navigator;
  const originalBeacon: unknown = Reflect.get(navigator, "sendBeacon");
  if (typeof originalBeacon === "function") {
    const own = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
    const gatedBeacon = (url: unknown, data?: unknown): boolean => {
      const resolved = resolveUrl(win, url);
      const call = () => Reflect.apply(originalBeacon, navigator, [url, data]);
      if (resolved === null) return Boolean(call());
      // Always a POST: a beacon only sends.
      return (
        consider({ via: "beacon", method: "POST", url: resolved }, call, () => {
          // Nothing to tell: a refused beacon is one that was never queued.
        }) !== "blocked"
      );
    };
    Reflect.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: gatedBeacon,
    });
    restores.push(() => {
      if (Reflect.get(navigator, "sendBeacon") !== gatedBeacon) return;
      if (own !== undefined)
        Reflect.defineProperty(navigator, "sendBeacon", own);
      else Reflect.deleteProperty(navigator, "sendBeacon");
    });
  }

  // --- forms -----------------------------------------------------------------
  const formPrototype = win.HTMLFormElement.prototype;
  const originalSubmit = formPrototype.submit;
  /** A form's submission, decided: let through, held or refused. */
  const considerForm = (
    form: HTMLFormElement,
    submitter: HTMLElement | null,
    send: () => void,
    refuse: () => void,
  ): "sent" | "held" | "blocked" | "dialog" => {
    const target = formTargetOf(win, form, submitter);
    if (target.method === "DIALOG") return "dialog";
    if (target.otherWindow) {
      blocked.push({ via: "form", method: target.method, url: target.url });
      refuse();
      return "blocked";
    }
    // A form NAVIGATES the frame: one to another site is refused even when
    // it only reads.
    return consider(
      { via: "form", method: target.method, url: target.url },
      send,
      refuse,
      { offSiteReads: "block" },
    );
  };
  const gatedSubmit = function (this: HTMLFormElement) {
    considerForm(
      this,
      null,
      () => originalSubmit.call(this),
      () => {},
    );
  };
  formPrototype.submit = gatedSubmit;
  restores.push(() => {
    if (formPrototype.submit === gatedSubmit) {
      formPrototype.submit = originalSubmit;
    }
  });

  /**
   * A form's `submit` event, before the page's own listeners: capture, on
   * the window. A GET to this site is left alone -- a search, a filter: a
   * navigation like a link. Anything else is cancelled here, and held unless
   * the page's own handler cancels it too: then the page handles the submit
   * itself, and whatever it sends goes through the wraps above.
   *
   * The page's handlers see the event already cancelled
   * (`defaultPrevented`), which is the one way this can be noticed.
   */
  const preventDefault = win.Event.prototype.preventDefault;
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof win.HTMLFormElement)) return;
    const submitterValue: unknown = Reflect.get(event, "submitter");
    const submitter =
      submitterValue instanceof win.HTMLElement ? submitterValue : null;
    const target = formTargetOf(win, form, submitter);
    if (target.method === "DIALOG") return;
    const leaves = target.otherWindow || !isSameSite(target.url, origin);
    if (!leaves && READ_METHODS.has(target.method)) return;
    preventDefault.call(event);
    if (leaves) {
      blocked.push({ via: "form", method: target.method, url: target.url });
      return;
    }
    let handledByPage = false;
    Reflect.defineProperty(event, "preventDefault", {
      configurable: true,
      value: () => {
        handledByPage = true;
      },
    });
    // Once every listener has had the event.
    win.queueMicrotask(() => {
      if (handledByPage) return;
      held.push({
        via: "form",
        method: target.method,
        url: target.url,
        send: () => submitNatively(form, submitter, target, originalSubmit),
        refuse: () => {},
      });
    });
  };
  win.addEventListener("submit", onSubmit, true);
  restores.push(() => win.removeEventListener("submit", onSubmit, true));

  return {
    held: () => held.map(({ via, method, url }) => ({ via, method, url })),
    blocked: () => [...blocked],
    stop: () => {
      for (const restore of restores.splice(0).reverse()) {
        try {
          restore();
        } catch {
          // Put back what can be put back.
        }
      }
      return { requests: [...held] };
    },
  };
}

/** Where a form goes, and how, as the browser resolves it. */
type FormTarget = { method: string; url: string; otherWindow: boolean };

function formTargetOf(
  win: Win,
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): FormTarget {
  // The submitter's own `formmethod`/`formaction`/`formtarget` win; the
  // properties are what the browser resolved (base URL included).
  const method =
    submitter !== null && submitter.hasAttribute("formmethod")
      ? String(Reflect.get(submitter, "formMethod"))
      : form.method;
  const url =
    submitter !== null && submitter.hasAttribute("formaction")
      ? String(Reflect.get(submitter, "formAction"))
      : form.action;
  const target =
    submitter?.getAttribute("formtarget") ??
    form.getAttribute("target") ??
    baseTargetOf(win.document);
  return {
    method: method.toUpperCase(),
    url: resolveUrl(win, url) ?? win.location.href,
    otherWindow: target !== null && target !== "" && target !== "_self",
  };
}

/** `<base target>`: where links and forms without a target of their own go. */
export function baseTargetOf(doc: Document): string | null {
  return doc.querySelector("base[target]")?.getAttribute("target") ?? null;
}

/**
 * Submit a held native submission the way the browser would have: to the
 * resolved address, with the method, and with the submitter's own name and
 * value -- which `form.submit()` alone leaves out.
 */
function submitNatively(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  target: FormTarget,
  submit: () => void,
): void {
  const saved: Array<[string, string | null]> = ["action", "method"].map(
    (name) => [name, form.getAttribute(name)],
  );
  form.setAttribute("action", target.url);
  form.setAttribute("method", target.method.toLowerCase());
  const name = submitter?.getAttribute("name");
  let extra: HTMLInputElement | null = null;
  if (submitter !== null && name) {
    extra = form.ownerDocument.createElement("input");
    extra.type = "hidden";
    extra.name = name;
    extra.value = String(Reflect.get(submitter, "value") ?? "");
    form.append(extra);
  }
  try {
    submit.call(form);
  } finally {
    extra?.remove();
    for (const [attribute, value] of saved) {
      if (value === null) form.removeAttribute(attribute);
      else form.setAttribute(attribute, value);
    }
  }
}

// --- holds -------------------------------------------------------------------

type Hold = { requests: readonly Held[]; timer: ReturnType<typeof setTimeout> };

/** The holds of each window: the requests waiting for the person. */
const HOLDS = new WeakMap<Window, Map<string, Hold>>();

function holdsOf(win: Window): Map<string, Hold> {
  let holds = HOLDS.get(win);
  if (holds === undefined) {
    holds = new Map();
    HOLDS.set(win, holds);
  }
  return holds;
}

/**
 * Keep held requests for the person to decide on: the id the Studio sends
 * back with Allow or Don't allow. Refused by themselves after
 * {@link HOLD_TIMEOUT_MS}.
 */
export function holdRequests(win: Window, held: HeldRequests): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const holds = holdsOf(win);
  const timer = setTimeout(() => {
    holds.delete(id);
    refuseAll(held.requests);
  }, HOLD_TIMEOUT_MS);
  holds.set(id, { requests: held.requests, timer });
  return id;
}

/**
 * Send (`allow`) or refuse what a hold kept: what the person decided. `null`
 * when there is no such hold any more -- refused already, timed out, or the
 * page reloaded.
 */
export function releaseHold(
  win: Window,
  id: string,
  allow: boolean,
): readonly PageRequest[] | null {
  const holds = holdsOf(win);
  const hold = holds.get(id);
  if (hold === undefined) return null;
  holds.delete(id);
  clearTimeout(hold.timer);
  for (const request of hold.requests) {
    try {
      if (allow) request.send();
      else request.refuse();
    } catch {
      // One that cannot be sent does not stop the rest.
    }
  }
  return hold.requests.map(({ via, method, url }) => ({ via, method, url }));
}

/** Refuse every hold of the window: a new action means they were not wanted. */
export function refuseAllHolds(win: Window): void {
  const holds = holdsOf(win);
  for (const [id, hold] of Array.from(holds)) {
    holds.delete(id);
    clearTimeout(hold.timer);
    refuseAll(hold.requests);
  }
}

/** Refuse requests a gate held and nobody kept. */
export function refuseHeld(held: HeldRequests): void {
  refuseAll(held.requests);
}

function refuseAll(requests: readonly Held[]): void {
  for (const request of requests) {
    try {
      request.refuse();
    } catch {
      // Nothing more to do for it.
    }
  }
}

// --- helpers -----------------------------------------------------------------

function isSameSite(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function resolveUrl(win: Window, value: unknown): string | null {
  try {
    const written =
      value instanceof URL
        ? value.href
        : typeof value === "string"
          ? value
          : null;
    if (written === null) return null;
    // Against the document's base URL, `<base href>` included.
    return new URL(written, win.document.baseURI).href;
  } catch {
    return null;
  }
}

function fetchRequestOf(
  win: Win,
  input: RequestInfo | URL,
  init?: RequestInit,
): PageRequest | null {
  try {
    const fromRequest =
      typeof input === "object" &&
      !(input instanceof URL) &&
      typeof Reflect.get(input, "url") === "string";
    const url = resolveUrl(
      win,
      fromRequest ? Reflect.get(input, "url") : input,
    );
    if (url === null) return null;
    const method = String(
      init?.method ??
        (fromRequest ? Reflect.get(input, "method") : undefined) ??
        "GET",
    ).toUpperCase();
    return { via: "fetch", method, url };
  } catch {
    return null;
  }
}

function abortError(win: Win): Error {
  const message = "The person did not allow this request to be sent.";
  return typeof win.DOMException === "function"
    ? new win.DOMException(message, "AbortError")
    : Object.assign(new Error(message), { name: "AbortError" });
}
